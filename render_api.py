"""The renderer's lines (both roles): /ws paints one picture per incoming frame, /make a picture or clip on request,
/health and /stats tell how the model is doing. On the Mac `guard` decides who may paint (#148: the stage, not
guests); the worker on the cloud GPU is reached only through the SSH tunnel and has none."""
import asyncio
import base64
import binascii
import concurrent.futures
import contextlib
import io
import json
import multiprocessing
import os
import re
import time

from fastapi import WebSocket, WebSocketDisconnect
from PIL import Image

import config
import flow
import i18n
import render
import styles
from web import app

guard = None                   # set by the app: may this socket paint?

# #205: the flow field between two pictures is estimated in a process of its own. In this process its many small steps
# would take turns with the thread that paints (Python runs one thread at a time): measured, the picture took as much
# longer as the estimate lasted. If the process cannot be started or dies, the estimate runs here in a thread instead.
flow_process = {"pool": None, "use": True}


def flow_pool():
    if flow_process["use"] and flow_process["pool"] is None:
        try:
            flow_process["pool"] = concurrent.futures.ProcessPoolExecutor(
                1, mp_context=multiprocessing.get_context("spawn"), initializer=flow.leave_with_parent)
        except (OSError, ValueError) as e:
            flow_process["use"] = False
            print("flow field: no process of its own, estimating in the renderer:", repr(e)[:200], flush=True)
    return flow_process["pool"] if flow_process["use"] else None


async def flow_packed(loop, before, small):
    """The packed field from the grey picture before to small (None: too little in common)."""
    pool = flow_pool()
    if pool is not None:
        try:
            return await loop.run_in_executor(pool, flow.packed_between, before.tobytes(), small.tobytes(), small.shape)
        except (concurrent.futures.process.BrokenProcessPool, OSError, RuntimeError) as e:
            flow_process.update(pool=None, use=False)
            print("flow field: its process is gone, estimating in the renderer:", repr(e)[:200], flush=True)
    return await loop.run_in_executor(None, flow.packed_between, before.tobytes(), small.tobytes(), small.shape)


@app.get("/health")
def health():
    """#238: also where the renderer stands (render.progress: loading, downloading, compiling, ready) – dream-cloud
    asks here, through the tunnel. Without the text of a load error: on the Mac a guest may ask here too."""
    return {"role": config.ROLE, "device": render.device, "models": sorted(render._pipes),
            **{k: v for k, v in render.progress().items() if k != "model_error"}}


_stats_last = {"t": time.time(), "busy": 0.0, "n": 0}


@app.get("/stats")
def stats():
    """Load of this Mac for the panel: pictures per second, share of time the image AI is busy, CPU and memory."""
    now = time.time()
    dt = max(now - _stats_last["t"], 1e-3)
    out = {"ai_fps": round((render._busy["n"] - _stats_last["n"]) / dt, 1),
           "ai_busy": round(min(1.0, (render._busy["t"] - _stats_last["busy"]) / dt) * 100),
           "device": render.device, "models": sorted(render._pipes),
           **render.progress()}                          # #179, #238: model, loading, first download, compiling
    _stats_last.update(t=now, busy=render._busy["t"], n=render._busy["n"])
    try:
        import psutil
        procs = _stats_last.setdefault("procs", {})          # keep the objects: cpu_percent measures since the last call
        me = procs.setdefault(os.getpid(), psutil.Process())
        out.update(cpu_dream=round(me.cpu_percent()), cpu_system=round(psutil.cpu_percent()),
                   mem_dream_gb=round(me.memory_info().rss / 1e9, 1), mem_system=round(psutil.virtual_memory().percent),
                   cores=psutil.cpu_count())
        # memory running out: the Mac moves memory to disk ("swapping") and everything crawls
        sw = psutil.swap_memory()
        prev = _stats_last.get("sout")
        rate = max(0.0, (sw.sout - prev) / dt / 1e6) if prev is not None else 0.0
        _stats_last["sout"] = sw.sout
        out.update(swap_gb=round(sw.used / 1e9, 1), swap_out_mb_s=round(rate, 1),
                   mem_warn=bool(out["mem_system"] >= 92 or rate > 5))
    except Exception:
        pass
    gpu = render.gpu_memory_gb()
    if gpu is not None:
        out["gpu_mem_gb"] = gpu
    return out


@app.websocket("/ws")
async def ws(sock: WebSocket):
    """Protocol: a JSON text message with the settings, then a binary JPEG frame; answer: JPEG + timing JSON.
    With a pose, the binary message is b"DRM2" + 4-byte length of the frame JPEG + frame JPEG + skeleton JPEG.
    #205: when the settings ask for it ("flow": true), a picture that follows from the one before is preceded by a
    binary message with the flow field between the two (flow.pack: it starts with b"DRMF")."""
    if guard and not guard(sock):                 # #148: rendering is for the stage, not for guests
        await sock.close(code=4403)
        return
    await sock.accept()
    i18n.current.set(i18n.from_cookie(sock.cookies.get("dream-lang")))      # #132: its messages in the page's language
    s = {"prompt": "psychedelic fractal dream", "strength": 0.5, "steps": 2, "seed": 1, "model": "sd-turbo"}
    painted_with = None
    loop = asyncio.get_running_loop()
    # #100: frames may overlap (the stage sends the next before the answer is back): receiving and decoding run
    # beside the GPU, the answers are encoded and sent beside the next frame's rendering, always in order
    frames: asyncio.Queue = asyncio.Queue(maxsize=3)

    def decode(data):
        pose = None
        if data[:4] == b"DRM2":
            n = int.from_bytes(data[4:8], "big")
            data, pose_bytes = data[8:8 + n], data[8 + n:]
            if pose_bytes:
                pose = Image.open(io.BytesIO(pose_bytes)).convert("RGB")
        return Image.open(io.BytesIO(data)).convert("RGB"), pose

    def encode(img, fmt):
        buf = io.BytesIO()
        if fmt == "webp":                             # #108: the cloud answers in WebP – a third of the bytes
            img.save(buf, "WEBP", quality=82, method=2)
        else:
            img.save(buf, "JPEG", quality=90)
        return buf.getvalue()

    async def field_after(earlier, out, follows):
        """#205: the picture small and grey, the flow field from the one before to it (None when it does not follow
        from it or the two have too little in common) and how long that took; beside the next picture's rendering."""
        t = time.perf_counter()
        small = packed = None
        try:
            before = (await earlier)[0] if earlier else None
            small = await loop.run_in_executor(None, flow.gray, out)
            if before is None and flow_pool() is not None:
                flow_pool().submit(flow.ready)        # the first picture of a run: the process starts meanwhile
            if follows and before is not None and before.shape == small.shape:
                packed = await flow_packed(loop, before, small)
        except Exception as e:                        # never worth a picture: it cross-fades
            print("flow field failed:", repr(e)[:200], flush=True)
        ms = (time.perf_counter() - t) * 1000
        render.perf_add("flow", ms)
        return small, packed, ms

    def _take_ref(m):
        h = str(m.get("ref") or "")
        if re.fullmatch(r"[0-9a-f]{12}", h) and not styles.has_ref(h):
            data = base64.b64decode(str(m["ref_data"])[:8_000_000])
            styles.add_ref(h, Image.open(io.BytesIO(data)).convert("RGB"))

    async def receive():
        try:
            while True:
                msg = await sock.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                try:                                  # #177: one broken message or picture is skipped, never ends the line
                    if msg.get("text"):
                        m = json.loads(msg["text"])
                        if not isinstance(m, dict):
                            continue
                        if "ref_data" in m:               # #123: the style reference picture, sent once per change
                            await loop.run_in_executor(None, _take_ref, m)
                            continue
                        s.update(m)
                        continue
                    if msg.get("bytes"):
                        t_dec = time.perf_counter()
                        img, pose = await loop.run_in_executor(None, decode, msg["bytes"])
                        render.perf_add("decode_in", (time.perf_counter() - t_dec) * 1000)   # #180
                        await frames.put((img, pose, dict(s), time.time()))   # the settings as they were for this frame
                except (ValueError, TypeError, OSError, KeyError, binascii.Error) as e:
                    print("render line: skipped a broken message:", repr(e)[:200], flush=True)
                    await frames.put(("skip", str(e)[:200]))
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:                                      # #177: whatever ends the reader, the loop below hears of it
            await frames.put(None)

    reader = asyncio.create_task(receive())
    sending = None
    flowing = None                                # #205: the flow field of the last picture, with its grey picture
    seeds = ()                                    # the seeds the last picture came from
    try:
        while True:
            item = await frames.get()
            if item is None:
                break
            if item[0] == "skip":                     # #177: a broken picture: answer anyway, so the stage sends on
                if sending:
                    await asyncio.gather(sending, return_exceptions=True)
                    sending = None
                await sock.send_text(json.dumps({"skipped": True}))
                continue
            img, pose, fs, t_in = item
            want = (int(fs.get("w") or 0), int(fs.get("h") or 0))
            if all(want) and img.size != want:            # #108: sent small to save the line, dreamed at full size
                img = await loop.run_in_executor(None, lambda im=img: im.resize(want, Image.BICUBIC))
            t0 = time.time()
            render.perf_add("queue", (t0 - t_in) * 1000)            # #180: how long the frame waited before rendering
            drift = {"seed2": int(fs["seed2"]) if fs.get("seed2") is not None else None,
                     "st": float(fs.get("st") or 0), "pt": float(fs.get("pt") or 0),
                     "prompt2": str(fs["prompt2"])[:500] if fs.get("prompt2") else None}
            try:
                out, used = await loop.run_in_executor(None, lambda: render.dream(
                    str(fs["model"]), img, str(fs["prompt"])[:500], float(fs["strength"]), int(fs["steps"]), int(fs["seed"]),
                    pose, float(fs.get("pose_scale", 0.8)), float(fs.get("edges") or 0),
                    {"style": str(fs.get("style") or ""), "sa": float(fs.get("sa") or 0),
                     "ref": str(fs.get("ref") or ""), "ra": float(fs.get("ra") or 0)}, **drift))
            except Exception as e:                     # #177: never swallowed – logged, and the stage is told what to do
                print("render error:", repr(e)[:300], flush=True)
                oom = "out of memory" in str(e).lower()
                if oom:
                    render.free_after_error()
                if sending:
                    await asyncio.gather(sending, return_exceptions=True)
                    sending = None
                await sock.send_text(json.dumps({"skipped": True, "render_error": i18n.t(
                    "Not enough memory for this picture – choose a smaller size, SD-Turbo, or close other programs.") if oom
                    else i18n.t("The picture failed: {e}", e=str(e)[:160])}))
                continue
            gpu_ms = int((time.time() - t0) * 1000)
            switch = used if painted_with and used != painted_with else None   # first picture of a new model: slow blend
            painted_with = used
            if fs.get("flow"):
                # #205: a new seed (not the one the drift was blending towards) or another model is a cut – no field
                follows = not switch and int(fs["seed"]) in seeds
                flowing = asyncio.create_task(field_after(flowing, out, follows))
            else:
                flowing = None
            seeds = (int(fs["seed"]), drift["seed2"] if drift["st"] > 0 else None)

            async def send(prev, out=out, gpu_ms=gpu_ms, switch=switch, t_in=t_in, used=used, fmt=fs.get("fmt"), flowing=flowing):
                t_enc = time.perf_counter()
                jpg = await loop.run_in_executor(None, encode, out, fmt)
                render.perf_add("encode_out", (time.perf_counter() - t_enc) * 1000)   # #180
                packed, flow_ms = (await flowing)[1:] if flowing else (None, None)
                if prev:
                    await asyncio.gather(prev, return_exceptions=True)   # the answers leave in the order the frames came
                if switch:
                    await sock.send_text(json.dumps({"switch": switch}))
                t_send = time.perf_counter()
                if packed:
                    await sock.send_bytes(packed)
                await sock.send_bytes(jpg)
                render.perf_add("send", (time.perf_counter() - t_send) * 1000)
                render.perf_add("server", (time.time() - t_in) * 1000)
                await sock.send_text(json.dumps({"ms": gpu_ms, "server_ms": int((time.time() - t_in) * 1000), "device": render.device,
                                                 **({} if flow_ms is None else {"flow_ms": round(flow_ms, 1)}),
                                                 "model": used, "loading": render.model_state["loading"], "error": render.model_state["error"],
                                                 "style_loading": styles.state["loading"],
                                                 "style_error": i18n.msg(styles.state["error"])}))
            sending = asyncio.create_task(send(sending))
        if sending:
            await asyncio.gather(sending, return_exceptions=True)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        reader.cancel()


@app.websocket("/make")
async def make(sock: WebSocket):
    """Picture or clip on request. Text: {"kind": "img"|"clip", "prompt", "model", "w", "h", "seed", "frames",
    "zoom", "rot", "strength", "start": bool}; with "start" a binary JPEG (the clip's first picture) follows.
    Answers: {"type": "pic"|"frame", "n", "of"} each followed by a JPEG, then {"done": true} or {"error": "..."}."""
    if guard and not guard(sock):                 # #148: rendering is for the stage, not for guests
        await sock.close(code=4403)
        return
    await sock.accept()
    loop = asyncio.get_running_loop()
    try:
        req = json.loads(await sock.receive_text())
        kind = "clip" if req.get("kind") == "clip" else "img"
        prompt = str(req.get("prompt") or "").strip()[:500]
        if not prompt:
            await sock.send_text(json.dumps({"error": i18n.t("No prompt.")}))
            return
        key = str(req.get("model") or "sd-turbo")
        w = min(1024, max(256, int(req.get("w") or 512))) // 8 * 8
        h = min(1024, max(256, int(req.get("h") or 512))) // 8 * 8
        seed = int(req.get("seed") or 1) % 2**31
        start = None
        if req.get("start"):
            data = (await sock.receive()).get("bytes") or b""
            start = Image.open(io.BytesIO(data)).convert("RGB").resize((w, h), Image.LANCZOS)
        if start is None:
            pic = await loop.run_in_executor(None, lambda: render.make_picture(key, prompt, w, h, seed, refine=kind == "img"))
            await sock.send_text(json.dumps({"type": "pic", "n": 0, "of": 1}))
            await sock.send_bytes(render._jpeg(pic))
            start = pic.resize((w, h), Image.LANCZOS)
        if kind == "clip":
            frames = min(120, max(12, int(req.get("frames") or 48)))
            zoom = min(0.03, max(-0.03, float(req.get("zoom") or 0.006)))
            rot = min(2.0, max(-2.0, float(req.get("rot") or 0.15)))
            strength = min(0.6, max(0.15, float(req.get("strength") or 0.25)))
            out = asyncio.Queue()

            def emit(i, img):
                loop.call_soon_threadsafe(out.put_nowait, (i, render._jpeg(img, 90)))

            job = loop.run_in_executor(None, lambda: render.make_clip(key, start, prompt, frames, zoom, rot, strength, seed, emit))
            job.add_done_callback(lambda _: out.put_nowait(None))       # ends the loop below, also on an error
            while (item := await out.get()) is not None:
                await sock.send_text(json.dumps({"type": "frame", "n": item[0], "of": frames}))
                await sock.send_bytes(item[1])
            await job
        await sock.send_text(json.dumps({"done": True}))
    except WebSocketDisconnect:
        pass
    except Exception as e:                      # e.g. out of memory: tell the page instead of hanging
        print(f"make failed: {e!r}", flush=True)
        with contextlib.suppress(Exception):
            await sock.send_text(json.dumps({"error": i18n.t("Making failed: {e}", e=type(e).__name__)}))
