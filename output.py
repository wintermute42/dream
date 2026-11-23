"""Where the stage's pictures go: the Syphon source for Resolume, the output windows and the small previews on
remotes (/view), fed by the stage over /out."""
import asyncio
import base64
import contextlib
import io
import json
import os
import threading
import time

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from PIL import Image

import config
import flow
import hub
import outbox
import render
import rights
import windows
from web import app

# ---------- Syphon: the stage sends every shown frame, Dream publishes it smoothly for Resolume ----------
# The AI makes only a few frames per second; the publisher shows the way from the last one to the newest at 30 fps:
# morphed along the flow field between them when the stage passed one on (#205), cross-faded otherwise.
syph = {"prev": None, "cur": None, "t_prev": 0.0, "t_cur": 0.0, "thread": None, "lock": threading.Lock(), "error": "",
        "field": None, "n": 0}   # field: (vectors, how much of them) for the newest picture; n: its number
announced = {"n": 0, "field": None}        # what the stage said about the picture that comes next


shown = {"frame": None}     # the last picture the stage showed (JPEG)


def syphon_worker():
    try:
        import syphon
        from syphon.utils.numpy import copy_image_to_mtl_texture
        from syphon.utils.raw import create_mtl_texture
        server = syphon.SyphonMetalServer("Dream")
    except Exception as e:                      # not macOS, or syphon-python missing
        syph["error"] = str(e)[:200]
        print("Syphon not available:", e, flush=True)
        syph["thread"] = None
        return
    from Foundation import NSDate, NSRunLoop
    tex, size = None, None
    way, way_of = None, None                    # the morph between the last two pictures (flow.Between)
    print("Syphon source 'Dream' running", flush=True)
    while hub.state["syphon"]:
        # a run-loop step instead of sleep: lets Syphon answer programs that look for sources later (Resolume)
        NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(1 / 30))
        with syph["lock"]:
            cur, prev, t0, t1, field = syph["cur"], syph["prev"], syph["t_prev"], syph["t_cur"], syph["field"]
        if cur is None:
            continue
        frame = cur
        if prev is not None and prev.shape == cur.shape:
            span = min(max(t1 - t0, 0.1), 1.5)
            a = min(1.0, (time.time() - t1) / span)
            if a < 1.0:
                if way_of is not cur:           # a new pair: its morph is prepared once
                    way, way_of = None, cur
                    if field is not None:
                        try:
                            way = flow.Between(prev, cur, field[0], field[1])
                        except Exception as e:  # a field that does not fit: this pair cross-fades
                            print("Syphon: flow field not usable:", repr(e)[:200], flush=True)
                frame = way.at(a) if way is not None else crossfade(prev, cur, a)
        h, w = frame.shape[:2]
        if size != (w, h):
            tex, size = create_mtl_texture(server.device, w, h), (w, h)
        copy_image_to_mtl_texture(frame, tex)
        server.publish_frame_texture(tex)
    server.stop()
    syph["thread"] = None
    print("Syphon stopped", flush=True)


def crossfade(prev, cur, a):
    """The cross-fade from prev to cur at a (0…1), 8 bit."""
    k = int(round(a * 256))
    return ((prev.astype(np.uint16) * (256 - k) + cur.astype(np.uint16) * k) >> 8).astype(np.uint8)


def syphon_picture(data: bytes, master: float) -> np.ndarray:
    """A picture of the stage as the Syphon source takes it (rows × columns × 4, 8 bit), dimmed by the master fader."""
    img = np.asarray(Image.open(io.BytesIO(data)).convert("RGBA"))
    if master < 1:
        img = img.astype(np.float32)
        img[..., :3] *= master
        img = img.astype(np.uint8)
    return np.ascontiguousarray(img)


def announce(text: str):
    """#205: the stage's word about the next picture – its number and the flow field from the one before it
    ({"n": 12, "flow": {"cols", "rows", "k", "data": base64}}). Anything that is not a usable field counts as none."""
    try:
        m = json.loads(text)
        n, f = int(m.get("n") or 0), m.get("flow")
        field = None
        if isinstance(f, dict):
            cols, rows, k = int(f["cols"]), int(f["rows"]), min(1.0, max(0.0, float(f["k"])))
            raw = base64.b64decode(str(f["data"]), validate=True)
            if cols >= 2 and rows >= 2 and len(raw) == cols * rows * 2 and k > 0:
                field = (np.frombuffer(raw, dtype=np.int8).reshape(rows, cols, 2).astype(np.float32) / flow.UNIT, k)
    except (ValueError, TypeError, KeyError, AttributeError):
        n, field = 0, None
    announced.update(n=n, field=field)


async def main_runloop():
    """Syphon answers "which sources are there?" (e.g. from a Resolume started later) on the main run loop;
    uvicorn's main thread runs asyncio, so give the run loop a moment ten times a second."""
    from Foundation import NSDate, NSRunLoop
    while hub.state["syphon"]:
        NSRunLoop.mainRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.002))
        await asyncio.sleep(0.1)
    syph["pump"] = None


def syphon_sync():
    if hub.state["syphon"] and syph["thread"] is None:
        syph["thread"] = threading.Thread(target=syphon_worker, daemon=True)
        syph["thread"].start()
    if hub.state["syphon"] and not syph.get("pump"):
        try:
            syph["pump"] = asyncio.get_running_loop().create_task(main_runloop())
        except RuntimeError:
            pass


# #187: remotes and Dreamy Eyes show the dream in a tile – they get it small (once shrunk for all of them), not the
# stage's full picture four times a second. A remote that shows it large ("hold") asks for the full one meanwhile.
PREVIEW_SIDE = 320                                 # the longer side, in pixels
PREVIEW_EVERY = 0.25
preview: dict = {"at": 0.0, "busy": False, "task": None}


def small_frame(data: bytes) -> bytes:
    img = Image.open(io.BytesIO(data))
    if max(img.size) <= PREVIEW_SIDE:
        return data
    img.draft("RGB", (PREVIEW_SIDE, PREVIEW_SIDE))   # a JPEG is decoded at a half, quarter or eighth right away
    img = img.convert("RGB")
    img.thumbnail((PREVIEW_SIDE, PREVIEW_SIDE), Image.BILINEAR)
    return render._jpeg(img, 80)


async def preview_send(data: bytes):
    try:
        small = None
        if any(size == "small" for size in hub.previews.values()):
            small = await asyncio.get_running_loop().run_in_executor(None, small_frame, data)
        for v, size in list(hub.previews.items()):
            if not outbox.post_frame(v, data if size == "full" else small or data):
                hub.previews.pop(v, None)
    except Exception as e:                         # not a picture: no preview of it
        print("preview:", repr(e)[:200], flush=True)
    finally:
        preview["busy"] = False


beat: dict = {"at": 0.0, "peak": 0.0}
BEAT_EVERY = 0.04                                  # seconds: at most 25 beats a second for Dreamy Eyes


def _unit(v) -> float:
    return min(1.0, max(0.0, float(v or 0)))


def beat_of(text: str) -> float | None:
    """#218: the beat in what the stage tells its output windows – one number, 0–1 – or None. The same number a dream
    window makes of it; nothing else of the message is read."""
    if '"pulse"' not in text:
        return None
    try:
        msg = json.loads(text)
        if isinstance(msg.get("fx"), dict):
            fx = msg["fx"]
            return min(1.0, _unit(fx.get("pulse")) * _unit(fx.get("k")) + _unit(fx.get("bass")) * 0.3)
        return _unit(msg["pulse"]) if "pulse" in msg else None
    except (ValueError, TypeError, AttributeError):
        return None


def beat_tell(text: str) -> None:
    """#218: Dreamy Eyes hear the beat – only the number, never the stage's message itself."""
    b = beat_of(text)
    if b is None:
        return
    beat["peak"] = max(beat["peak"], b)
    now = time.time()
    if now - beat["at"] < BEAT_EVERY:
        return
    told = json.dumps({"pulse": round(beat["peak"], 3)})
    beat.update(at=now, peak=0.0)
    for v in list(hub.beats):
        outbox.post(v, told)


@app.websocket("/out")
async def out(sock: WebSocket):
    """The stage sends every frame it shows (JPEG) for Syphon and the output windows; only from this Mac."""
    if not rights.ws_can(sock, "stage"):           # #175: this Mac, from Dream's own page
        await sock.close(code=4403)
        return
    await sock.accept()
    try:
        while True:
            msg = await sock.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("text"):                    # {"fade": …} at a model switch, {"fx": …} the autopilot's effects
                text = msg["text"]
                if len(text) > 6000:               # far more than these ever are (the largest carries a flow field): not passed on
                    continue
                if '"morph"' in text:              # #205: what the next picture is, for the Syphon source
                    announce(text)
                for v in list(hub.viewers):
                    outbox.post(v, text)
                if hub.beats:
                    beat_tell(text)
                continue
            data = msg.get("bytes")
            if not data:
                continue
            shown["frame"] = data
            now = time.time()
            if hub.previews and not preview["busy"] and now - preview["at"] >= PREVIEW_EVERY:   # #141: 4 pictures a second
                preview.update(at=now, busy=True)
                preview["task"] = asyncio.create_task(preview_send(data))
            for v in list(hub.viewers):                # #187: queued, the latest picture only – no window holds up another
                if not outbox.post_frame(v, data):
                    hub.viewers.discard(v)
            if hub.state["syphon"]:
                # #205 (Pf-6 of #187): decoded beside the event loop, so no other device waits for it
                n, field = announced["n"], announced["field"]
                announced.update(n=0, field=None)
                img = await asyncio.get_running_loop().run_in_executor(None, syphon_picture, data, hub.state["master"])
                with syph["lock"]:
                    syph["prev"], syph["t_prev"] = syph["cur"], syph["t_cur"]
                    syph["cur"], syph["t_cur"] = img, time.time()
                    # the field leads here from the picture before: only if that one is the one Syphon has
                    syph["field"] = field if n and n == syph["n"] + 1 else None
                    syph["n"] = n
                syphon_sync()
    except (WebSocketDisconnect, RuntimeError):
        pass


@app.get("/output")
def output_page():
    return FileResponse(os.path.join(config.HERE, "static", "output.html"))


@app.websocket("/view")
async def view(sock: WebSocket):
    """An output window (beamer, second monitor): gets every picture the stage shows, renders nothing itself."""
    if not rights.ws_can(sock, "view"):
        await sock.close(code=4403)
        return
    await sock.accept()
    hub.key_roles[sock] = rights.ws_role(sock)
    outbox.box(sock)
    small = sock.query_params.get("preview") == "1"   # #141: the remote's small live preview
    if small:
        hub.previews[sock] = "small"
        if sock.query_params.get("as") == "eyes" and rights.ws_can(sock, "beat"):   # #218: Dreamy Eyes hear the beat
            hub.beats.add(sock)
    else:
        hub.viewers.add(sock)
    if sock.query_params.get("as") == "window":    # #201: a dream window – it gets seeds of the organism
        windows.window_add(sock)
    await hub.broadcast(hub.status_msg())                  # the stage starts sending its pictures
    try:
        outbox.post(sock, json.dumps({"master": hub.state["master"]}))
        if sock in hub.windows:
            windows.window_greet(sock)             # #214: the painted faces, their points, its motif
            await windows.window_tell_all()
        frame = shown["frame"]
        if frame and small:
            with contextlib.suppress(Exception):
                frame = await asyncio.get_running_loop().run_in_executor(None, small_frame, frame)
        if frame:
            outbox.post_frame(sock, frame)
        while True:
            text = await sock.receive_text()       # keeps the socket open; a preview may ask for its size (#187)
            if small and len(text) < 100:
                with contextlib.suppress(ValueError, AttributeError):
                    size = json.loads(text).get("size")
                    if size in ("small", "full") and sock in hub.previews and hub.previews[sock] != size:
                        hub.previews[sock] = size
                        if size == "full" and shown["frame"]:
                            outbox.post_frame(sock, shown["frame"])
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.viewers.discard(sock)
        hub.previews.pop(sock, None)
        hub.beats.discard(sock)
        hub.key_roles.pop(sock, None)
        outbox.drop(sock)
        if sock in hub.windows:
            await windows.window_remove(sock)
        await hub.broadcast(hub.status_msg())


hub.on_change("syphon", syphon_sync)
