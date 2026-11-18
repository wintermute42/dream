"""The MediaPipe files of the movement detection (#85), fetched once and cached."""
import asyncio
import os
import shutil
import threading
import urllib.request

from fastapi.responses import FileResponse, Response

from web import app

# ---------- movement detection runs in the stage (#85): its MediaPipe files, fetched once and cached ----------
# The stage tracks hands/body (pose model on the GPU) and light (fire, LEDs) itself on the camera picture; the
# library and model come from here, downloaded on first use into ~/.cache/dream/mediapipe and then offline.
MP_VER = "0.10.14"
_mp_npm = f"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{MP_VER}/"
MP_FILES = {
    "vision_bundle.mjs": _mp_npm + "vision_bundle.mjs",
    "wasm/vision_wasm_internal.js": _mp_npm + "wasm/vision_wasm_internal.js",
    "wasm/vision_wasm_internal.wasm": _mp_npm + "wasm/vision_wasm_internal.wasm",
    "wasm/vision_wasm_nosimd_internal.js": _mp_npm + "wasm/vision_wasm_nosimd_internal.js",
    "wasm/vision_wasm_nosimd_internal.wasm": _mp_npm + "wasm/vision_wasm_nosimd_internal.wasm",
    "pose_landmarker_lite.task": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
                                 "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    # #157: Dreamy Eyes find the face in front of them (where it is, whether it smiles) – on the phone itself
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
                            "face_landmarker/float16/latest/face_landmarker.task",
    # #162: the silhouette of whoever stands in front of the Dreamy Eyes (a mask for the dream, on the phone)
    "selfie_segmenter.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
                               "selfie_segmenter/float16/latest/selfie_segmenter.tflite",
}
MP_TYPES = {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".task": "application/octet-stream", ".tflite": "application/octet-stream"}
MP_CACHE = os.path.expanduser(os.path.join(os.environ.get("DREAM_CACHE", "~/.cache/dream"), "mediapipe", MP_VER))
_mp_lock = threading.Lock()


def mp_file(name: str) -> str | None:
    """The cached file, downloaded first if needed; None if it is unknown or cannot be fetched (offline)."""
    if name not in MP_FILES:
        return None
    path = os.path.join(MP_CACHE, name)
    with _mp_lock:
        if not os.path.isfile(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            try:
                with urllib.request.urlopen(MP_FILES[name], timeout=60) as r, open(path + ".part", "wb") as f:
                    shutil.copyfileobj(r, f)
                os.replace(path + ".part", path)
                print(f"movement detection: {name} cached", flush=True)
            except Exception as e:
                print(f"movement detection: {name} not available ({e})", flush=True)
                return None
    return path


@app.get("/mp/{name:path}")
async def mp_asset(name: str):
    path = await asyncio.get_running_loop().run_in_executor(None, mp_file, name)
    if not path:
        return Response(status_code=404 if name not in MP_FILES else 503)
    return FileResponse(path, media_type=MP_TYPES.get(os.path.splitext(name)[1], "application/octet-stream"),
                        headers={"Cache-Control": "max-age=31536000, immutable"})
