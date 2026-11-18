"""The owner's media: uploads from Dream Control, the gallery of pictures and clips made on request, the style
reference pictures."""
import asyncio
import contextlib
import hashlib
import io
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid

from fastapi import File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image

import hub
import i18n
import paths
from web import app

MEDIA_DIR = os.path.join(hub.STATE_DIR, "media")
os.makedirs(MEDIA_DIR, exist_ok=True)
MAX_UPLOAD = 200 * 1024 * 1024
MEDIA_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
               "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm"}


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    ext = MEDIA_TYPES.get(file.content_type or "")
    if not ext:
        return JSONResponse({"error": i18n.t("Only JPEG, PNG, WebP, GIF, MP4, MOV or WebM.")}, status_code=415)
    for old in os.listdir(MEDIA_DIR):                      # keep only the newest few files
        p = os.path.join(MEDIA_DIR, old)
        if not old.startswith("g-") and time.time() - os.path.getmtime(p) > 6 * 3600:   # gallery: see below
            os.remove(p)
    name = uuid.uuid4().hex + ext
    size = 0
    with open(os.path.join(MEDIA_DIR, name), "wb") as f:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                f.close()
                os.remove(os.path.join(MEDIA_DIR, name))
                return JSONResponse({"error": i18n.t("File larger than 200 MB.")}, status_code=413)
            f.write(chunk)
    kind = "vid" if file.content_type.startswith("video/") else "img"
    await hub.broadcast({"cmd": "media", "arg": {"kind": kind, "url": f"/media/{name}"}})
    return {"kind": kind, "url": f"/media/{name}"}


# ---------- gallery: the last pictures and clips made on request (only until Dream restarts) ----------
GALLERY_MAX = 5
gallery: list = []
SAVE_DIR = paths.save_dir()                                # #186: DREAM_SAVE_DIR, default ~/Pictures/Dream
for old in os.listdir(MEDIA_DIR):                          # a new run starts with an empty gallery
    if old.startswith("g-"):
        with contextlib.suppress(OSError):
            os.remove(os.path.join(MEDIA_DIR, old))


def gallery_list() -> list:
    return [{k: g[k] for k in ("id", "kind", "url", "thumb", "prompt", "saved")} for g in gallery]


def gallery_find(gid: str):
    return next((g for g in gallery if g["id"] == gid), None)


async def gallery_add(entry: dict):
    gallery.insert(0, entry)
    while len(gallery) > GALLERY_MAX:
        for f in gallery.pop()["files"]:
            with contextlib.suppress(OSError):
                os.remove(f)
    await hub.broadcast({"gallery": gallery_list()})


def encode_clip(frames: list, fps: int, out: str):
    """Frames forth and back (a seamless loop) → H.264 MP4 that every browser plays."""
    with tempfile.TemporaryDirectory() as tmp:
        size = Image.open(io.BytesIO(frames[-1])).size
        for i, data in enumerate(frames):            # all frames in one size (the first picture may be larger)
            im = Image.open(io.BytesIO(data))
            if im.size != size:
                buf = io.BytesIO()
                im.convert("RGB").resize(size, Image.LANCZOS).save(buf, "JPEG", quality=92)
                frames[i] = buf.getvalue()
        seq = frames + frames[-2:0:-1]
        for i, data in enumerate(seq):
            with open(os.path.join(tmp, f"f{i:04d}.jpg"), "wb") as f:
                f.write(data)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", str(fps), "-i",
                        os.path.join(tmp, "f%04d.jpg"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out],
                       check=True, timeout=120)


@app.post("/gallery")
async def gallery_post(kind: str = Form("img"), prompt: str = Form(""), fps: int = Form(12),
                       use: str = Form("1"), files: list[UploadFile] = File(...)):
    """The stage hands in what the renderer made: one JPEG (picture) or the frames of a clip."""
    if kind not in ("img", "clip") or not files or len(files) > 121:
        return JSONResponse({"error": i18n.t("Invalid request.")}, status_code=400)
    datas = []
    for f in files:
        data = await f.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024 or not data.startswith(b"\xff\xd8"):
            return JSONResponse({"error": i18n.t("Only JPEG pictures.")}, status_code=415)
        datas.append(data)
    gid = uuid.uuid4().hex[:12]
    thumb = os.path.join(MEDIA_DIR, f"g-{gid}-t.jpg")
    first = Image.open(io.BytesIO(datas[0])).convert("RGB")
    first.thumbnail((240, 240))
    first.save(thumb, quality=85)
    if kind == "img":
        path = os.path.join(MEDIA_DIR, f"g-{gid}.jpg")
        with open(path, "wb") as f:
            f.write(datas[0])
    else:
        if not shutil.which("ffmpeg"):
            os.remove(thumb)
            return JSONResponse({"error": i18n.t("ffmpeg is missing (brew install ffmpeg).")}, status_code=501)
        path = os.path.join(MEDIA_DIR, f"g-{gid}.mp4")
        try:
            await asyncio.get_running_loop().run_in_executor(None, encode_clip, datas, min(30, max(4, fps)), path)
        except (subprocess.SubprocessError, OSError) as e:
            os.remove(thumb)
            return JSONResponse({"error": i18n.t("The clip could not be saved ({e}).", e=type(e).__name__)}, status_code=500)
    name = os.path.basename(path)
    entry = {"id": gid, "kind": kind, "url": f"/media/{name}", "thumb": f"/media/{os.path.basename(thumb)}",
             "prompt": prompt.strip()[:500], "saved": "", "files": [path, thumb]}
    await gallery_add(entry)
    if use == "1":
        await gallery_use(gid)
    return {k: entry[k] for k in ("id", "kind", "url", "thumb", "prompt", "saved")}


@app.post("/gallery/{gid}/use")
async def gallery_use(gid: str):
    g = gallery_find(gid)
    if not g:
        return JSONResponse({"error": i18n.t("No longer in the gallery.")}, status_code=404)
    await hub.broadcast({"cmd": "media", "arg": {"kind": "img" if g["kind"] == "img" else "vid", "url": g["url"]}})
    return {"ok": True}


# #142: deleting – the entries leave the gallery at once, their files 6 s later unless "Undo" brings them back
UNDO_SECS = 6
removed: dict = {"batch": None, "items": [], "task": None}


def _drop_files(items):
    for _, g in items:
        for f in g["files"]:
            with contextlib.suppress(OSError):
                os.remove(f)


async def gallery_remove(gids: list) -> dict:
    if removed["task"]:                            # an earlier deletion is final now
        removed["task"].cancel()
        _drop_files(removed["items"])
    items = [(i, g) for i, g in enumerate(gallery) if g["id"] in gids]
    for _, g in items:
        gallery.remove(g)
    batch = uuid.uuid4().hex[:8]
    removed.update(batch=batch, items=items)

    async def later():
        await asyncio.sleep(UNDO_SECS)
        if removed["batch"] == batch:
            _drop_files(items)
            removed.update(batch=None, items=[], task=None)
    removed["task"] = asyncio.create_task(later())
    await hub.broadcast({"gallery": gallery_list()})
    # what was the input right now goes: the stage dreams on from its current picture
    await hub.broadcast({"cmd": "gallery_removed", "arg": {"urls": [g["url"] for _, g in items]}})
    return {"undo": batch, "count": len(items), "secs": UNDO_SECS}


@app.post("/gallery/{gid}/delete")
async def gallery_delete(gid: str):
    if not gallery_find(gid):
        return JSONResponse({"error": i18n.t("No longer in the gallery.")}, status_code=404)
    return await gallery_remove([gid])


@app.post("/gallery/clear")
async def gallery_clear():
    return await gallery_remove([g["id"] for g in gallery])


@app.post("/gallery/undo/{batch}")
async def gallery_undo(batch: str):
    if removed["batch"] != batch:
        return JSONResponse({"error": i18n.t("Too late – already deleted.")}, status_code=410)
    if removed["task"]:
        removed["task"].cancel()
    for i, g in sorted(removed["items"]):          # back where they were
        gallery.insert(min(i, len(gallery)), g)
    removed.update(batch=None, items=[], task=None)
    while len(gallery) > GALLERY_MAX:              # meanwhile something new came: the oldest goes
        for f in gallery.pop()["files"]:
            with contextlib.suppress(OSError):
                os.remove(f)
    await hub.broadcast({"gallery": gallery_list()})
    return {"ok": True}


@app.post("/gallery/{gid}/save")
async def gallery_save(gid: str):
    """Keeps a picture or clip for good in ~/Pictures/Dream (the gallery itself is temporary)."""
    g = gallery_find(gid)
    if not g:
        return JSONResponse({"error": i18n.t("No longer in the gallery.")}, status_code=404)
    if not g["saved"]:
        os.makedirs(SAVE_DIR, exist_ok=True)
        slug = re.sub(r"[^a-z0-9]+", "-", g["prompt"].lower())[:40].strip("-") or "dream"
        src = g["files"][0]
        dest = os.path.join(SAVE_DIR, f"dream-{time.strftime('%Y%m%d-%H%M%S')}-{slug}{os.path.splitext(src)[1]}")
        shutil.copyfile(src, dest)
        g["saved"] = paths.shown(dest)
        await hub.broadcast({"gallery": gallery_list()})
    return {"saved": g["saved"]}


# ---------- style reference pictures (#123): kept by their content's id, so scenes can name them ----------
REF_DIR = os.path.join(hub.STATE_DIR, "refs")
os.makedirs(REF_DIR, mode=0o700, exist_ok=True)


@app.post("/style-ref")
async def style_ref_upload(file: UploadFile = File(...)):
    data = await file.read(30 * 1024 * 1024)
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return JSONResponse({"error": i18n.t("Not a picture (JPEG, PNG, WebP or GIF).")}, status_code=415)
    img.thumbnail((768, 768))                     # enough for the picture encoder (it sees 224 px)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    h = hashlib.sha1(buf.getvalue()).hexdigest()[:12]
    with open(os.path.join(REF_DIR, h + ".jpg"), "wb") as f:
        f.write(buf.getvalue())
    return {"ref": h}


@app.get("/style-ref/{h}")
def style_ref_file(h: str):
    path = os.path.join(REF_DIR, h + ".jpg")
    if not re.fullmatch(r"[0-9a-f]{12}", h) or not os.path.isfile(path):
        return Response(status_code=404)
    return FileResponse(path, media_type="image/jpeg")


@app.get("/media/{name}")
def media(name: str):
    path = os.path.join(MEDIA_DIR, os.path.basename(name))
    if not os.path.isfile(path):
        return Response(status_code=404)
    return FileResponse(path)
