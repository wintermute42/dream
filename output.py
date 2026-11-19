"""Where the stage's pictures go: the Syphon source for Resolume, the output windows and the small previews on
remotes (/view), fed by the stage over /out."""
import asyncio
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
import hub
import outbox
import render
import rights
import windows
from web import app

# ---------- Syphon: the stage sends every shown frame, Dream publishes it smoothly for Resolume ----------
# The AI makes only a few frames per second; the publisher crossfades between the last two at 30 fps.
syph = {"prev": None, "cur": None, "t_prev": 0.0, "t_cur": 0.0, "thread": None, "lock": threading.Lock(), "error": ""}


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
    print("Syphon source 'Dream' running", flush=True)
    while hub.state["syphon"]:
        # a run-loop step instead of sleep: lets Syphon answer programs that look for sources later (Resolume)
        NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(1 / 30))
        with syph["lock"]:
            cur, prev, t0, t1 = syph["cur"], syph["prev"], syph["t_prev"], syph["t_cur"]
        if cur is None:
            continue
        if prev is not None and prev.shape == cur.shape:
            span = min(max(t1 - t0, 0.1), 1.5)
            a = min(1.0, (time.time() - t1) / span)
            frame = cur if a >= 1.0 else prev * (1 - a) + cur * a
        else:
            frame = cur
        frame = np.ascontiguousarray(frame, dtype=np.uint8)
        h, w = frame.shape[:2]
        if size != (w, h):
            tex, size = create_mtl_texture(server.device, w, h), (w, h)
        copy_image_to_mtl_texture(frame, tex)
        server.publish_frame_texture(tex)
    server.stop()
    syph["thread"] = None
    print("Syphon stopped", flush=True)


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
                if len(text) > 4000:               # far more than these ever are: not passed on
                    continue
                for v in list(hub.viewers):
                    outbox.post(v, text)
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
                img = np.asarray(Image.open(io.BytesIO(data)).convert("RGBA"), dtype=np.float32)
                if hub.state["master"] < 1:
                    img[..., :3] *= hub.state["master"]
                with syph["lock"]:
                    syph["prev"], syph["t_prev"] = syph["cur"], syph["t_cur"]
                    syph["cur"], syph["t_cur"] = img, time.time()
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
        hub.key_roles.pop(sock, None)
        outbox.drop(sock)
        if sock in hub.windows:
            await windows.window_remove(sock)
        await hub.broadcast(hub.status_msg())


hub.on_change("syphon", syphon_sync)
