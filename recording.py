"""#276: recording what the audience sees. The stage (index.html, static/recorder.js) records its own output picture
with the browser's MediaRecorder and hands the video in, piece by piece, about once a second; Dream appends every
piece to the file in the save folder at once – a crash or a closed tab loses at most the last seconds, and what is on
disk stays a playable file (WebM is a stream; Chrome's MP4 is written in fragments). A recording ends by itself after
MAX_SECS (owner's decision: at most 15 minutes, one file); the pages count down the time left.

Dream decides here, never the page: the file name (date and time), the size and the bit rate of the video, when the
time is up, when the disk is too full to go on, and who may start or stop (this Mac and Dream Control; guests nothing).
The pages learn the state over /ctl ({"rec": …}, `status`); only roles with "control" hear it.

Routes (only this Mac's stage – rights.LOCAL_ONLY): POST /rec/start, /rec/chunk/{id}, /rec/end/{id}, /rec/reveal (the
last file in the Finder)."""
import asyncio
import contextlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time

from fastapi import Request
from fastapi.responses import JSONResponse

import hub
import outbox
import paths
import rights
from web import app

MAX_SECS = 15 * 60                # a recording ends by itself after this long
GRACE_SECS = 30                   # … the stage stops it itself; pieces later than this are refused (fail closed)
CHUNK_MAX = 16 * 1024 * 1024      # one piece (about a second; 2 MB at the highest quality) – anything larger is refused
STOP_FREE = 1024 ** 3             # below this much free space the recording stops (macOS itself needs room)
HARD_FREE = 256 * 1024 ** 2       # … and a piece that would leave less than this is not written at all
SILENT_SECS = 15                  # no piece for this long: the stage is gone (closed, crashed) – the recording ends
# #276 (owner): one quality – about 8 Mbit/s at 1080p and 30 frames a second; a smaller picture gets less in proportion
# to its pixels. The sound (the music input, when Dream listens to music) takes AUDIO_BPS.
VIDEO_BPS = 8_000_000
AUDIO_BPS = 128_000
FULL = 1920 * 1080
MIME = re.compile(r"video/(mp4|webm)(;\s*codecs=\"?[\w.,]+\"?)?")
REC_ID = re.compile(r"[0-9a-f]{16}")
REASONS = ("stop", "time", "disk", "error")

take: dict = {}                   # the recording running now (empty: none): its file, where it is, its numbers
done: dict = {}                   # the one before: {"name", "path", "bytes", "secs", "reason"}
note: dict = {"error": ""}
tidying: set = set()              # the files ffmpeg tidies right now (remux)


# ---------- what Dream decides: the size, the bit rate ----------
def frame_size(pw, ph, mime: str) -> tuple[int, int]:
    """The video's size for a picture of pw × ph: its shape, as large as fits 1920 × 1080 (H.264) – WebM (VP8/VP9,
    encoded on the processor beside the AI) at most 1280 × 720. Even numbers (the encoders need them)."""
    try:
        pw, ph = float(pw), float(ph)
    except (TypeError, ValueError):
        pw, ph = 16.0, 9.0
    if not (0 < pw < 1e5 and 0 < ph < 1e5):
        pw, ph = 16.0, 9.0
    mw, mh = (1920, 1080) if mime.startswith("video/mp4") else (1280, 720)
    s = min(mw / pw, mh / ph)
    return max(2, int(pw * s) // 2 * 2), max(2, int(ph * s) // 2 * 2)


def video_bps(w: int, h: int) -> int:
    return max(1_000_000, round(VIDEO_BPS * w * h / FULL))


def free_bytes() -> int:
    """Free space where the recordings go (a test replaces it)."""
    folder = paths.save_dir()
    os.makedirs(folder, exist_ok=True)
    return shutil.disk_usage(folder).free


# ---------- the file ----------
def _open(stem: str, ext: str) -> tuple[str, int]:
    """A new file in the save folder, never one that is there already (fail closed: never written over)."""
    folder = paths.save_dir()
    os.makedirs(folder, exist_ok=True)
    for extra in range(1, 100):
        path = os.path.join(folder, f"{stem}.{ext}" if extra == 1 else f"{stem}-{extra}.{ext}")
        with contextlib.suppress(FileExistsError):
            return path, os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_APPEND, 0o644)
    raise FileExistsError(stem)


def remux(path: str) -> None:
    """A recording that ended cleanly is copied once into a tidy file of the same kind (ffmpeg, nothing encoded anew):
    WebM gets its length and seek points, MP4 its index at the front – every player opens it. Without ffmpeg, without
    room for the copy or if it fails, the file stays as it was written (playable too)."""
    if not shutil.which("ffmpeg"):
        return
    with contextlib.suppress(OSError):
        if free_bytes() - os.path.getsize(path) < STOP_FREE:
            return
    root, ext = os.path.splitext(path)
    tmp = f"{root}.tidy{ext}"
    try:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-c", "copy", "-map", "0",
                        *(["-movflags", "+faststart"] if ext == ".mp4" else []), tmp],
                       check=True, timeout=600, stdin=subprocess.DEVNULL, capture_output=True)
        os.replace(tmp, path)
    except (subprocess.SubprocessError, OSError) as e:
        print("recording: kept as written –", repr(e)[:200], flush=True)
        with contextlib.suppress(OSError):
            os.remove(tmp)


def finish(reason: str) -> None:
    """The recording ends: the file is closed (an empty one removed), tidied when it ended cleanly; `done` says what
    was recorded."""
    if not take:
        return
    t = dict(take)
    take.clear()
    with contextlib.suppress(OSError):
        os.close(t["fd"])
    kept = t["bytes"] > 0
    if not kept:                                   # nothing came: no empty file left behind
        with contextlib.suppress(OSError):
            os.remove(t["path"])
    elif reason in ("stop", "time", "disk"):
        path = t["path"]
        try:
            job = asyncio.get_running_loop().run_in_executor(None, remux, path)
            tidying.add(path)
            job.add_done_callback(lambda _: tidying.discard(path))
        except RuntimeError:                       # no event loop (a script): right away
            remux(path)
    done.clear()
    done.update(name=os.path.basename(t["path"]) if kept else "", path=t["path"] if kept else "", bytes=t["bytes"],
                secs=round((t["seen"] if reason == "interrupted" else time.monotonic()) - t["t0"]), reason=reason)


# ---------- what the pages learn ----------
def status() -> dict:
    st = {"on": bool(take), "error": note["error"], "max_secs": MAX_SECS,
          "last": {k: done[k] for k in ("name", "bytes", "secs", "reason")} if done else None}
    if take:
        st.update(secs=round(time.monotonic() - take["t0"]), file=os.path.basename(take["path"]), bytes=take["bytes"],
                  w=take["w"], h=take["h"], kind=take["ext"], audio=take["abps"] > 0)
    return {"rec": st}


def tell() -> None:
    """To every page with the right "control" (the panel, Dream Control) – queued, never awaited."""
    msg = json.dumps(status(), ensure_ascii=False)
    for c in list(hub.clients):
        if rights.can(hub.roles.get(c), "control") and not rights.can(hub.roles.get(c), "eyes_only"):
            outbox.post(c, msg)


def greet(sock) -> None:
    if rights.can(hub.roles.get(sock), "control"):
        outbox.post(sock, json.dumps(status(), ensure_ascii=False))


async def command(arg, by=None) -> None:
    """Start or stop, from the panel, Dream Control, a MIDI button or the key: the stage does it. The rights are the
    caller's (ctl.py lets no guest send it; MIDI and the keys are this Mac's)."""
    want = arg if arg in ("start", "stop") else ("stop" if take else "start")
    if want == "start" and not any(k == "stage" for k in hub.clients.values()):
        note["error"] = "nostage"
        tell()
        return
    note["error"] = ""
    await hub.broadcast({"cmd": "rec", "arg": want, **({"by": by} if by else {})}, only="stage")
    tell()


def stage_error(code) -> None:
    """The stage could not record (no MediaRecorder, a refused start, the upload fell behind): the pages say so."""
    if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,20}", code):
        note["error"] = code
        tell()


async def keep() -> None:
    """Started with the server: the running time once a second, and the watch for a stage that went away in the middle
    of a recording."""
    while True:
        await asyncio.sleep(1.0)
        with contextlib.suppress(Exception):
            watch(time.monotonic())


def watch(now: float) -> None:
    if take and now - take["seen"] > SILENT_SECS:
        finish("interrupted")
        note["error"] = "interrupted"
        tell()
    elif take and now - take["t0"] > MAX_SECS + GRACE_SECS:   # the stage did not stop it: Dream does
        finish("time")
        tell()
    elif take:                                     # the running time on every page, once a second
        tell()


def _json_error(code: str, status_code: int) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status_code)


async def _body(request: Request) -> dict:
    try:
        raw = await request.body()
        data = json.loads(raw) if raw and len(raw) <= 4096 else {}
    except ValueError:
        data = {}
    return data if isinstance(data, dict) else {}


@app.post("/rec/start")
async def rec_start(request: Request):
    """The stage begins a recording: {pw, ph (its picture), mime (what its browser records), audio}. Dream answers with
    the file, the video's size and bit rate and how long it may run – or refuses (fail closed)."""
    d = await _body(request)
    mime = str(d.get("mime") or "")
    if not MIME.fullmatch(mime):
        return _json_error("format", 415)
    if take:
        return _json_error("busy", 409)
    try:
        free = free_bytes()
    except OSError:
        return _json_error("folder", 507)
    if free < STOP_FREE + 256 * 1024 ** 2:
        note["error"] = "disk"
        tell()
        return _json_error("disk", 507)
    ext = "mp4" if mime.startswith("video/mp4") else "webm"
    w, h = frame_size(d.get("pw"), d.get("ph"), mime)
    audio = bool(d.get("audio"))
    try:
        path, fd = _open("dream-rec-" + time.strftime("%Y%m%d-%H%M%S"), ext)
    except OSError:
        return _json_error("folder", 507)
    now = time.monotonic()
    take.update(id=secrets.token_hex(8), path=path, fd=fd, ext=ext, t0=now, seen=now, seq=0, bytes=0, w=w, h=h,
                bps=video_bps(w, h), abps=AUDIO_BPS if audio else 0)
    note["error"] = ""
    tell()
    return {"id": take["id"], "name": os.path.basename(path), "w": w, "h": h, "bps": take["bps"], "abps": take["abps"],
            "max_secs": MAX_SECS}


def _mine(rid: str) -> bool:
    return bool(take) and bool(REC_ID.fullmatch(rid)) and secrets.compare_digest(rid, take["id"])


@app.post("/rec/chunk/{rid}")
async def rec_chunk(rid: str, request: Request, seq: int = -1):
    """One piece, in order: appended to the file at once. {"stop": "time" | "disk"} asks the stage to stop."""
    if not _mine(rid):
        return _json_error("gone", 410)
    if seq < take["seq"]:                          # sent twice (an answer that was lost): it is there already
        return {"ok": True, "again": True}
    if seq != take["seq"]:                         # a piece missing: the file would be broken from here on
        return _json_error("order", 409)
    if time.monotonic() - take["t0"] > MAX_SECS + GRACE_SECS:
        finish("time")
        tell()
        return JSONResponse({"error": "time", "stop": "time"}, status_code=409)
    if int(request.headers.get("content-length") or 0) > CHUNK_MAX:
        return _json_error("size", 413)
    data = bytearray()
    async for piece in request.stream():
        data += piece
        if len(data) > CHUNK_MAX:
            return _json_error("size", 413)
    free = free_bytes()
    if free - len(data) < HARD_FREE:               # the disk is (nearly) full: nothing more is written
        finish("disk")
        note["error"] = "disk"
        tell()
        return JSONResponse({"error": "disk", "stop": "disk"}, status_code=507)
    try:
        os.write(take["fd"], bytes(data))
    except OSError:
        finish("error")
        note["error"] = "folder"
        tell()
        return _json_error("folder", 507)
    now = time.monotonic()
    take.update(seq=take["seq"] + 1, bytes=take["bytes"] + len(data), seen=now)
    stop = "disk" if free - len(data) < STOP_FREE else "time" if now - take["t0"] >= MAX_SECS else ""
    return {"ok": True, **({"stop": stop} if stop else {})}


@app.post("/rec/end/{rid}")
async def rec_end(rid: str, reason: str = "stop"):
    """The stage's recorder has stopped and its last piece is here: the file is closed."""
    if not _mine(rid):
        return _json_error("gone", 410)
    finish(reason if reason in REASONS else "stop")
    tell()
    return {"ok": True, "last": status()["rec"]["last"]}


@app.post("/rec/reveal")
async def rec_reveal():
    """#276: the last recording in the Finder – only on this Mac (LOCAL_ONLY), only the file Dream wrote itself."""
    path = done.get("path") or ""
    if sys.platform != "darwin" or not path or not os.path.isfile(path):
        return _json_error("gone", 404)
    subprocess.Popen(["open", "-R", path], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"ok": True}

