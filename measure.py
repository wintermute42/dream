"""A measurement run (#180): 60 s with fixed settings, the parts of a picture and the devices' frames."""
import asyncio
import contextlib
import json
import os
import time

from fastapi import Body
from fastapi.responses import JSONResponse

import eyes
import hub
import i18n
import render
import render_api
from web import app

MEASURE_PROMPT = "a glowing jellyfish nebula drifting through a violet ocean, bioluminescent, dreamy"
MEASURE_FIXED = {"prompt": MEASURE_PROMPT, "seed": 1, "strength": 0.5, "quality": 2, "size": 512, "mode": "dream",
                 "fx": "", "edges": False, "pose": False, "style": "", "style_ref": "", "drift": 0.0, "auto": False,
                 "playlist": "", "smooth": 0.3}
measure: dict = {"run": None, "reports": {}, "last": None}


def _summary(values: list) -> dict:
    v = sorted(values)
    if not v:
        return {"n": 0}
    pick = lambda q: round(v[min(len(v) - 1, int(q * (len(v) - 1) + 0.5))], 1)
    return {"n": len(v), "mean": round(sum(v) / len(v), 1), "p50": pick(0.5), "p95": pick(0.95)}


STEP_NAMES = [("queue", "waiting before rendering"), ("decode_in", "decoding the incoming picture"),
              ("wait_gpu", "waiting for the GPU"), ("prompt", "prompt encoding"), ("unet", "UNet (diffusion)"),
              ("controlnet", "ControlNet"), ("decode", "decoder (latents → picture)"), ("render", "picture in all"),
              ("encode_out", "JPEG/WebP encoding"), ("send", "sending"), ("server", "server time per picture")]

# #204: what draws the dream picture on a page – the graphics card, or the Canvas 2D drawing it falls back to
RENDER_NAMES = {"webgl2": "WebGL 2 · ", "canvas": "Canvas 2D (no WebGL 2) · ", "mixed": "WebGL 2 and Canvas 2D · "}


def measure_table(r: dict) -> str:
    lines = [f"Measurement {r['seconds']} s · {r['model']} {r['size']} · {r['ai_steps']} steps · {r['backend']} ({r['device']})"
             + (" · fixed settings" if r["fixed"] else ""),
             f"AI pictures/s: {r['fps']}   GPU memory: {r.get('gpu_mem_gb', '–')} GB   Dream memory: {r.get('mem_dream_gb', '–')} GB",
             f"{'part':34} {'mean':>8} {'p50':>8} {'p95':>8}   (ms, per picture)"]
    for k, name in STEP_NAMES:
        st = r["steps"].get(k)
        if st and st.get("n"):
            lines.append(f"{name:34} {st['mean']:>8} {st['p50']:>8} {st['p95']:>8}")
    for kind, d in sorted(r["devices"].items()):
        lines.append(f"{kind:12} {d.get('n', 1)}× · {RENDER_NAMES.get(d.get('render'), '')}{d.get('fps', '–')} fps display · frame {d.get('ms_avg', '–')} ms"
                     f" (p95 {d.get('ms_p95', '–')}) · slow frames {d.get('slow_pct', '–')} %")
    return "\n".join(lines)


async def measure_run(seconds: int, fixed: bool):
    before = {k: hub.state[k] for k in MEASURE_FIXED} if fixed else None
    try:
        if fixed:
            await hub.apply(MEASURE_FIXED, by="measure")
            await asyncio.sleep(4)                 # settle: the stage takes the settings, the model is ready
        measure["reports"] = {}
        render._perf.update(on=True, steps={}, frames=0)
        t0 = time.time()
        msg = {"measure": {"ms": seconds * 1000}}
        await hub.broadcast(msg)
        await eyes.eyes_send(msg)
        await asyncio.sleep(seconds)
        render._perf["on"] = False
        dt = time.time() - t0
        await asyncio.sleep(6)                     # the devices' reports (a busy page may report a little late)
        devices: dict = {}
        for (kind, _), rep_ in measure["reports"].items():
            d = devices.setdefault(kind, {"n": 0, "fps": [], "ms_avg": [], "ms_p95": [], "slow_pct": [], "render": set()})
            d["n"] += 1
            d["render"].add(rep_.get("render"))
            for k in ("fps", "ms_avg", "ms_p95", "slow_pct"):
                d[k].append(rep_.get(k, 0))
        devices = {k: {"n": d["n"], **{f: round(sum(d[f]) / len(d[f]), 1) for f in ("fps", "ms_avg", "ms_p95", "slow_pct")},
                       "render": "mixed" if len(d["render"]) > 1 else next(iter(d["render"]))}
                   for k, d in devices.items()}
        st = render_api.stats()
        r = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "seconds": seconds, "fixed": fixed, "device": render.device,
             "backend": hub.state.get("backend"), "model": render.model_state.get("active") or hub.state.get("model"),
             "size": f"{hub.state.get('size')}px", "ai_steps": hub.state.get("quality"),
             "fps": round(render._perf["frames"] / max(dt, 1e-3), 2), "frames": render._perf["frames"],
             "steps": {k: _summary(v) for k, v in render._perf["steps"].items()}, "devices": devices,
             "gpu_mem_gb": st.get("gpu_mem_gb"), "mem_dream_gb": st.get("mem_dream_gb")}
        r["table"] = measure_table(r)
        print(r["table"], flush=True)
        with contextlib.suppress(OSError):
            os.makedirs(os.path.join(hub.STATE_DIR, "measure"), exist_ok=True)
            with open(os.path.join(hub.STATE_DIR, "measure", time.strftime("%Y%m%d-%H%M%S") + ".json"), "w") as f:
                json.dump(r, f, indent=1)
        measure["last"] = r
        await hub.broadcast({"measure_result": r})
    finally:
        render._perf["on"] = False
        measure["run"] = None
        if before:
            await hub.apply(before, by="measure")


@app.post("/measure")
async def measure_start(body: dict = Body(default={})):
    """Dream Control and this Mac (#180): a measurement run – {"seconds": 60, "fixed": true}."""
    if measure["run"]:
        return JSONResponse({"error": i18n.t("A measurement is running already.")}, status_code=409)
    seconds = int(min(max(int(body.get("seconds") or 60), 10), 300))
    measure["run"] = asyncio.get_running_loop().create_task(measure_run(seconds, bool(body.get("fixed", True))))
    return {"started": True, "seconds": seconds}


@app.get("/measure")
def measure_last():
    return measure["last"] or {}
