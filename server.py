"""Dream – a live AI dream machine.

One file, two roles (environment variable DREAM_ROLE):
- "app" (default, on the Mac): serves the page (static/index.html), transcribes voice locally (Whisper on MLX),
  rewrites it into an English prompt with a small local Ollama model, controls the Scaleway GPU through
  ./dream-cloud, and renders frames on the Apple GPU when the page chooses "local".
- "worker" (on the Scaleway GPU instance): only renders frames on CUDA; reached through an SSH tunnel.

The page prepares every input frame (prompt feedback loop, camera, image, video, music) and sends it over a
WebSocket; the server runs one SD-Turbo / SDXL-Turbo image-to-image step and sends the result back.
Both roles listen on 127.0.0.1 only.
"""
import asyncio
import base64
import binascii
import contextlib
import gc
import hashlib
import io
import ipaddress
import json
import logging
import math
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import torch
from fastapi import Body, FastAPI, File, Form, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image

import i18n
import midi
import outbox
import paths
import playlists
import sensors
import styles

HERE = os.path.dirname(os.path.abspath(__file__))
ROLE = os.environ.get("DREAM_ROLE", "app")
WHISPER = os.environ.get("DREAM_WHISPER", "mlx-community/whisper-large-v3-turbo")
OLLAMA = os.environ.get("DREAM_OLLAMA", "http://127.0.0.1:11434")
PROMPT_MODEL = os.environ.get("DREAM_PROMPT_MODEL", "llama3.2:3b")
SOURCE_URL = os.environ.get("DREAM_SOURCE_URL", "https://github.com/wintermute42/dream")   # #178: AGPL §13 – where the code is
CLOUD = os.environ.get("DREAM_CLOUD_CMD") or os.path.join(HERE, "dream-cloud")   # the override is for tests (no real cloud)

# model key -> (pipeline repo, tiny decoder repo, is SDXL)
MODELS = {
    "sd-turbo": ("stabilityai/sd-turbo", "madebyollin/taesd", False),
    "sdxl-turbo": ("stabilityai/sdxl-turbo", "madebyollin/taesdxl", True),
}

# OpenPose ControlNets: the dancer's skeleton (from flowtrack /pose.jpg) shapes the figure
# ControlNets per kind: "pose" (the dancer's skeleton) and "edges" (#113: the outlines of the input picture keep the
# body and the room recognisable while the content is dreamed). Downloaded on first use.
CONTROLNETS = {
    "pose": {"sd-turbo": "thibaud/controlnet-sd21-openpose-diffusers",     # SD 2.1 family, ~0.7 GB
             "sdxl-turbo": "xinsir/controlnet-openpose-sdxl-1.0"},         # SDXL, ~2.5 GB (Apache 2.0), for the cloud
    "edges": {"sd-turbo": "thibaud/controlnet-sd21-canny-diffusers",       # ~0.7 GB
              "sdxl-turbo": "xinsir/controlnet-canny-sdxl-1.0"},           # ~2.5 GB (Apache 2.0)
}

if torch.cuda.is_available():
    device, dtype = "cuda", torch.float16
    torch.backends.cuda.matmul.allow_tf32 = True
elif torch.backends.mps.is_available():
    device, dtype = "mps", torch.float16
else:
    device, dtype = "cpu", torch.float32

_pipes: dict = {}
_cn_models: dict = {}          # (model, kind) -> ControlNet
_ctl_pipes: dict = {}          # (model, kinds) -> the model with these ControlNets on top
_load_lock = threading.Lock()   # reading weights from disk, one at a time; a model holds it for its whole load, warm-up included
_build_lock = threading.Lock()  # #187: building on a loaded model (with ControlNets, the picture generator); taken before _load_lock
gpu_lock = threading.Lock()
# #129: on the Mac, a garbage collection set off by any thread (loading a model, the web server) could free GPU objects
# of the painting thread, and Metal aborts the whole app ("Cannot form weak reference to instance … of class
# MPSGraph"). So Python's cycle collector runs only between two pictures, holding the GPU, every 15 s.
if device == "mps":
    gc.disable()

    def _collect_between_pictures():
        while True:
            time.sleep(15)
            with gpu_lock:
                gc.collect()
    threading.Thread(target=_collect_between_pictures, daemon=True, name="gc").start()
_embeds: dict = {}            # (model, prompt) -> prompt embeddings, a few kept


def _slerp(a, b, t):
    """Spherical blend of two noise tensors: stays Gaussian-like all the way (a plain mix would turn grey)."""
    fa, fb = a.flatten(), b.flatten()
    omega = torch.acos(torch.clamp(torch.dot(fa, fb) / (fa.norm() * fb.norm()), -1.0, 1.0))
    if omega.abs() < 1e-4:
        return (1 - t) * a + t * b
    so = torch.sin(omega)
    return (torch.sin((1 - t) * omega) / so) * a + (torch.sin(t * omega) / so) * b


@contextlib.contextmanager
def _blended_noise(pipe, seed, seed2, t):
    """Seed drift: the img2img start noise is a blend of two seeds' noise (pipelines draw it with randn_tensor)."""
    if seed2 is None or t <= 0:
        yield
        return
    mod = sys.modules[type(pipe).__module__]
    orig = mod.randn_tensor

    def blended(shape, generator=None, device=None, dtype=None, **kw):
        a = torch.randn(shape, generator=torch.Generator(device="cpu").manual_seed(seed))
        b = torch.randn(shape, generator=torch.Generator(device="cpu").manual_seed(seed2))
        return _slerp(a, b, min(float(t), 1.0)).to(device=device, dtype=dtype)

    mod.randn_tensor = blended
    try:
        yield
    finally:
        mod.randn_tensor = orig


def _prompt_embeds(p, key, prompt):
    """The encoded prompt, as the pipelines take it: {"prompt_embeds"} for SD, with {"pooled_prompt_embeds"} for SDXL
    (#187: SDXL ran its two text encoders for every picture). Encoding costs time: a few are kept. A style model
    changes SDXL's text encoders too (styles.py), so there the style and its amount belong to the key."""
    xl = MODELS[key][2]
    k = (key, prompt, styles.state["key"], styles.state["amt"]) if xl else (key, prompt)
    if k not in _embeds:
        if len(_embeds) >= 8:
            _embeds.pop(next(iter(_embeds)))
        if xl:
            e = p.encode_prompt(prompt=prompt, device=device, num_images_per_prompt=1, do_classifier_free_guidance=False)
            _embeds[k] = {"prompt_embeds": e[0], "pooled_prompt_embeds": e[2]}
        else:
            _embeds[k] = {"prompt_embeds": p.encode_prompt(prompt, device, 1, False)[0]}
    return _embeds[k]


def _prompt_args(p, key, prompt, prompt2=None, pt=0.0):
    """The prompt for one picture; with prompt2 and pt > 0 blended towards prompt2 (drift, scene changes)."""
    e = _prompt_embeds(p, key, prompt)
    if prompt2 is not None and prompt2 != prompt and pt > 0:
        e2, t = _prompt_embeds(p, key, prompt2), float(min(pt, 1.0))
        e = {name: torch.lerp(v, e2[name], t) for name, v in e.items()}
    return e


def _ready(key: str) -> bool:
    """Loaded and warmed up (a model is in _pipes from the moment its weights are there – its warm-up needs it)."""
    return key in _pipes and model_state["loading"] != key


def pipeline(key: str):
    """Loads a model on first use (the Mac in cloud mode never loads one)."""
    if _ready(key):                                     # #187: a model in use never waits for another one's load
        return _pipes[key]
    with _load_lock:
        if key not in _pipes:
            from diffusers import AutoencoderTiny, AutoPipelineForImage2Image
            repo, vae, _ = MODELS[key]
            print(f"Loading {repo} on {device} …", flush=True)
            # #129: read from disk beside the model that paints, but onto the GPU only between two pictures
            p = AutoPipelineForImage2Image.from_pretrained(repo, torch_dtype=dtype,
                                                           variant="fp16" if dtype == torch.float16 else None)
            p.vae = AutoencoderTiny.from_pretrained(vae, torch_dtype=dtype)
            with gpu_lock:
                p = p.to(device)
            p.set_progress_bar_config(disable=True)
            _pipes[key] = p
            if MODELS[key][2] and device == "cuda" and os.environ.get("DREAM_WITH_REF") == "1":
                try:                                  # #131: a reference picture was in use – compile with its adapter
                    styles.ip_download()
                    styles.ip_ready(p)
                except Exception as e:                # the reference picture is a bonus: SDXL runs without it
                    print(f"style reference adapter not loaded: {e!r}", flush=True)
            if MODELS[key][2] and device == "cuda":
                try:
                    styles.prime(p)                   # #131: before compiling, so a style switch needs no new compile
                except Exception as e:
                    print(f"style models not primed: {e!r}", flush=True)
            _speed_up(key, p)
            _render(key, Image.new("RGB", (512, 512), (40, 20, 60)), "psychedelic colors", 0.5, 2, 1)  # warm up
            print(f"{key} ready.", flush=True)
    return _pipes[key]


COMPILE_CACHE = os.environ.get("DREAM_COMPILE_CACHE", os.path.join(HERE, "compile-cache"))


def _cache_file(key, p):
    """#131: the compiled code depends on GPU, PyTorch, model and adapter – one cache file for each such combination."""
    gpu = re.sub(r"[^A-Za-z0-9]+", "-", torch.cuda.get_device_name(0)).strip("-")
    ref = "-ref" if getattr(p, "_dream_ip", False) else ""
    return os.path.join(COMPILE_CACHE, f"{gpu}-torch{torch.__version__.split('+')[0]}-{key}{ref}.bin")


def _speed_up(key, p):
    """#100/#131: on an NVIDIA GPU (the cloud) the model is compiled before its first picture: torch.compile of the
    UNet and the tiny decoder, channels-last memory and TF32, one variant (the reference adapter only if it was in
    use). The compiled code is kept as a cache file that dream-cloud brings to the Mac and back to the next GPU of the
    same type: the first start on a GPU type compiles for some minutes, later ones about one. (Compiling while
    painting was tried and is not usable: 0.2–0.4 pictures/s and broken pictures, cloud test 2026-11-17.)
    If compiling fails, the model simply runs as before. DREAM_COMPILE=0 switches it off."""
    if device != "cuda" or os.environ.get("DREAM_COMPILE", "1") == "0":
        return
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True
    cache = _cache_file(key, p)
    if os.path.isfile(cache):
        try:
            with open(cache, "rb") as f:
                torch.compiler.load_cache_artifacts(f.read())
            print(f"{key}: compiling with the cache {os.path.basename(cache)} (about a minute) …", flush=True)
        except Exception as e:                           # an old or broken cache: compile from scratch
            print(f"{key}: cache not usable ({str(e).splitlines()[0][:120]})", flush=True)
            cache_hit = False
        else:
            cache_hit = True
    else:
        cache_hit = False
        print(f"{key}: compiling for this GPU type for the first time (some minutes; later starts about one) …", flush=True)
    eager = (p.unet, p.vae.decoder)
    t0 = time.time()
    try:
        p.unet.to(memory_format=torch.channels_last)
        p.unet = torch.compile(p.unet, fullgraph=False)
        p.vae.decoder = torch.compile(p.vae.decoder, fullgraph=False)
        look = {"ref": ""} if getattr(p, "_dream_ip", False) else None   # with the adapter: its one variant
        for size in (512, 384):                          # the usual sizes, compiled now and not on stage
            _render(key, Image.new("RGB", (size, size), (40, 20, 60)), "psychedelic colors", 0.5, 2, 1, look=look)
        print(f"{key}: compiled for the GPU in {time.time() - t0:.0f} s", flush=True)
    except Exception as e:                               # compiling is a bonus: without it Dream still works
        p.unet, p.vae.decoder = eager
        print(f"{key}: compiling failed, running uncompiled ({str(e).splitlines()[0][:160]})", flush=True)
        return
    if not cache_hit:
        try:
            art = torch.compiler.save_cache_artifacts()
            if art:
                os.makedirs(COMPILE_CACHE, exist_ok=True)
                with open(cache + ".part", "wb") as f:
                    f.write(art[0])
                os.replace(cache + ".part", cache)
                print(f"{key}: compile cache saved ({len(art[0]) // 1_000_000} MB)", flush=True)
        except Exception as e:
            print(f"{key}: compile cache not saved ({e!r})", flush=True)


def control_pipeline(key: str, kinds: tuple):
    """The same model with the ControlNets of these kinds on top (one or several; loaded on first use)."""
    if (key, kinds) in _ctl_pipes:                      # #187: built already – no lock, so a model that loads in the
        return _ctl_pipes[(key, kinds)]                 # background (it holds _load_lock) never stops these pictures
    with _build_lock:
        if (key, kinds) not in _ctl_pipes:
            from diffusers import AutoPipelineForImage2Image, ControlNetModel
            for k in kinds:
                if (key, k) not in _cn_models:
                    print(f"Loading ControlNet {CONTROLNETS[k][key]} …", flush=True)
                    with _load_lock:                    # only a ControlNet used for the first time waits for a load
                        cn = ControlNetModel.from_pretrained(CONTROLNETS[k][key], torch_dtype=dtype)
                    with gpu_lock:
                        _cn_models[(key, k)] = cn.to(device)
            cns = [_cn_models[(key, k)] for k in kinds]
            p = AutoPipelineForImage2Image.from_pipe(_pipes[key], controlnet=cns[0] if len(cns) == 1 else cns)
            p.set_progress_bar_config(disable=True)
            _ctl_pipes[(key, kinds)] = p
            print(f"{key} + {' + '.join(kinds)} ready.", flush=True)
    return _ctl_pipes[(key, kinds)]


def edge_map(img):
    """#113: the outlines of a picture, white on black (as the canny ControlNets learned them): a light blur against
    camera noise, the gradient strength (Sobel), the strongest ~10 % kept and thinned to the local maxima across the
    edge – thin lines along body, arms and furniture, like a canny edge picture."""
    import numpy as np
    from PIL import ImageFilter, ImageOps
    g = np.asarray(ImageOps.grayscale(img).filter(ImageFilter.GaussianBlur(1.4)), dtype=np.float32)
    p = np.pad(g, 1, mode="edge")
    gx = (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    gy = (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    mag = np.hypot(gx, gy)
    # thin: keep a pixel only where it is the strongest along its gradient direction (horizontal or vertical step)
    m = np.pad(mag, 1, mode="edge")
    horiz = np.abs(gx) >= np.abs(gy)
    keep = np.where(horiz, (mag >= m[1:-1, :-2]) & (mag >= m[1:-1, 2:]), (mag >= m[:-2, 1:-1]) & (mag >= m[2:, 1:-1]))
    thr = max(float(np.percentile(mag, 90)), 20.0)
    out = ((mag >= thr) & keep).astype(np.uint8) * 255
    return Image.fromarray(out).convert("RGB")


_busy = {"t": 0.0, "n": 0}     # time spent rendering and pictures made (for the load display)

# ---------- measuring (#180): where the time of a picture goes ----------
# Off it costs nothing. During a measurement run every part of a picture is timed – synchronised with the GPU, so the
# times are real (that makes the run itself a little slower) – and gathered as milliseconds per part.
_perf: dict = {"on": False, "steps": {}, "frames": 0}
_perf_frame = threading.local()


def _gpu_sync():
    with contextlib.suppress(Exception):
        if device == "mps":
            torch.mps.synchronize()
        elif device == "cuda":
            torch.cuda.synchronize()


def perf_add(name: str, ms: float):
    if _perf["on"]:
        _perf["steps"].setdefault(name, []).append(ms)


@contextlib.contextmanager
def _perf_part(label: str):
    """Adds the time of one part of the current picture (only while measuring)."""
    cur = getattr(_perf_frame, "cur", None)
    if not _perf["on"] or cur is None:
        yield
        return
    _gpu_sync()
    t = time.perf_counter()
    try:
        yield
    finally:
        _gpu_sync()
        cur[label] = cur.get(label, 0.0) + (time.perf_counter() - t) * 1000


def _perf_wrap(obj, name: str, label: str):
    """Times a method of a model part (UNet, decoder, text encoding) from now on; costs nothing while not measuring."""
    f = getattr(obj, name, None)
    if f is None or getattr(f, "_dream_perf", False):
        return

    def timed(*a, **k):
        with _perf_part(label):
            return f(*a, **k)
    timed._dream_perf = True
    setattr(obj, name, timed)


@contextlib.contextmanager
def _gpu_turn():
    """The GPU for one picture – and, while measuring, how long the picture waited for it."""
    t = time.perf_counter()
    with gpu_lock:
        cur = getattr(_perf_frame, "cur", None)
        if cur is not None:
            cur["wait_gpu"] = cur.get("wait_gpu", 0.0) + (time.perf_counter() - t) * 1000
        yield


def _render(key, img, prompt, strength, steps, seed, pose=None, pose_scale=0.8, seed2=None, st=0.0, prompt2=None, pt=0.0,
            edges=0.0, look=None):
    """seed2/st: start noise blended from seed towards seed2; prompt2/pt: prompt blended towards prompt2 (drift);
    edges: how strongly the input's outlines lead (0 = off, #113); look: the real style for SDXL (#123):
    {"style": key, "sa": amount, "ref": reference hash, "ra": amount}."""
    t0 = time.time()
    _perf_frame.cur = {} if _perf["on"] else None     # #180
    try:
        return _render_now(key, img, prompt, strength, steps, seed, pose, pose_scale, seed2, st, prompt2, pt, edges, look)
    finally:
        _busy["t"] += time.time() - t0
        _busy["n"] += 1
        cur, _perf_frame.cur = _perf_frame.cur, None
        if cur is not None and _perf["on"]:
            _perf["frames"] += 1
            for k, v in cur.items():
                perf_add(k, v)
            perf_add("render", (time.time() - t0) * 1000)


def _render_now(key, img, prompt, strength, steps, seed, pose, pose_scale, seed2, st, prompt2, pt, edges=0.0, look=None):
    p = _pipes[key]
    # SD/SDXL-Turbo denoise int(steps * strength) times; keep at least one.
    if steps * strength < 1:
        steps = int(1 / max(strength, 0.05)) + 1
    gen = torch.Generator(device="cpu").manual_seed(seed)    # same noise every frame = calmer motion
    args = dict(image=img, strength=strength, num_inference_steps=steps, guidance_scale=0.0,
                generator=gen, output_type="pil")
    if _perf["on"]:                                            # #180: time the parts of the picture
        _perf_wrap(p.unet, "forward", "unet")
        _perf_wrap(p.vae, "decode", "decode")
    with _gpu_turn(), torch.no_grad():
        if MODELS[key][2]:                                    # #123: style model and reference picture (SDXL only)
            look = look or {}
            styles.apply(p, look.get("style"), look.get("sa", 0))
            if look.get("ref") and not getattr(p, "_dream_ip", False):
                styles.ip_load_later(p)                       # first reference picture: the adapter comes in the background
                if getattr(p, "_dream_ip", False) and hasattr(p.unet, "_orig_mod"):
                    p.unet = p.unet._orig_mod                 # #131: with the adapter it paints uncompiled (a new
                    for (k, _), cp in _ctl_pipes.items():     # compile would hold the stage for minutes); the next
                        if k == key:                          # cloud start compiles it with the adapter
                            cp.unet = p.unet
            args.update(styles.ip_args(p, look.get("ref"), look.get("ra", 0)))
        with _perf_part("prompt"):                            # #187: encoded once per prompt, for every way to paint
            args.update(_prompt_args(p, key, prompt, prompt2, pt))
        if pose is not None or edges > 0:                     # skeleton and/or outlines shape the picture
            kinds, imgs, scales = [], [], []
            if pose is not None:
                kinds.append("pose"); imgs.append(pose.resize(img.size)); scales.append(float(pose_scale))
            if edges > 0:
                kinds.append("edges"); imgs.append(edge_map(img)); scales.append(float(edges))
            pp = _ctl_pipes[(key, tuple(kinds))]
            if _perf["on"]:
                _perf_wrap(pp.controlnet, "forward", "controlnet")
            one = len(kinds) == 1
            with _blended_noise(pp, seed, seed2, st):
                out = pp(control_image=imgs[0] if one else imgs,
                         controlnet_conditioning_scale=scales[0] if one else scales, **args)
        else:
            with _blended_noise(p, seed, seed2, st):
                out = p(**args)
    return out.images[0]


# ---------- switching models without a gap (#61) ----------
# The model in use keeps dreaming while the next one loads in the background; then the old one is freed.
NEED_GB = {"sd-turbo": 4.0, "sdxl-turbo": 9.0}          # memory a model needs while loading (weights + working space)
model_state = {"active": None, "loading": None, "error": None, "error_key": None, "error_at": 0.0, "first": False}


def _free_memory():
    with gpu_lock:                                   # #129: never while a picture is being painted
        _free_memory_now()


def _free_memory_now():
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    elif device == "cuda":
        torch.cuda.empty_cache()


def release(key):
    """Frees a model and everything built on it (pose ControlNet, picture generator, prompt cache)."""
    with _build_lock, _load_lock, gpu_lock:
        for d in (_pipes, _t2i, _full_vae):
            d.pop(key, None)
        for d in (_cn_models, _ctl_pipes):
            for k in [k for k in d if k[0] == key]:
                d.pop(k, None)
        for k in [k for k in _embeds if k[0] == key]:
            _embeds.pop(k, None)
        if MODELS.get(key, (0, 0, False))[2]:
            styles.forget()
    _free_memory()
    print(f"{key} freed.", flush=True)


def _room_for(key) -> bool:
    """Is there room to load key while the current model stays? (unknown → yes, the OS will cope)"""
    try:
        import psutil
        return psutil.virtual_memory().available / 1e9 > NEED_GB.get(key, 9.0) + 2.0
    except Exception:
        return True


def _load_in_background(key):
    def run():
        try:
            old = model_state["active"]
            if old and old != key and not _room_for(key):
                # too little memory for both: free the old one first (the stage holds its last picture meanwhile)
                print(f"little memory: freeing {old} before loading {key}", flush=True)
                model_state["active"] = None
                release(old)
            pipeline(key)
            model_state["error"] = model_state["error_key"] = None
        except Exception as e:                       # e.g. not downloaded, no network: keep the old one
            print(f"loading {key} failed: {e!r}", flush=True)
            model_state.update(error=f"{type(e).__name__}: {e}"[:300], error_key=key, error_at=time.time())
            _pipes.pop(key, None)
            _free_memory()
        finally:
            model_state["loading"] = None

    model_state["loading"] = key
    threading.Thread(target=run, daemon=True, name=f"load-{key}").start()


def _drop_others(keep):
    for old in [k for k in list(_pipes) if k != keep]:
        release(old)


def _in_cache(repo: str) -> bool:
    """#179: whether a model is already downloaded (else its first load is a download of gigabytes)."""
    try:
        from huggingface_hub import try_to_load_from_cache
        return isinstance(try_to_load_from_cache(repo, "model_index.json"), str)
    except Exception:
        return True                                    # unknown: no download hint rather than a wrong one


def use_model(key) -> str:
    """The model to paint the next picture with: the wanted one once it is ready, the current one until then."""
    key = key if key in MODELS else "sd-turbo"
    active = model_state["active"]
    if not _ready(key):                               # #187: not before its warm-up picture is through either
        if active in _pipes:                          # keep painting with the current model meanwhile
            failed_lately = model_state["error_key"] == key and time.time() - model_state["error_at"] < 60
            if not model_state["loading"] and not failed_lately:
                _load_in_background(key)
            if not model_state["loading"]:
                _drop_others(active)                  # e.g. switched there and back: the half-wanted one goes
            return active
        # nothing to paint with: wait for it (the stage holds its picture) – and say so (#179: on the very first start the
        # model is downloaded first, which takes minutes; the stage shows it instead of an empty "Connected")
        model_state["loading"], model_state["first"] = key, not _in_cache(MODELS[key][0])
        try:
            pipeline(key)
        finally:
            model_state["loading"], model_state["first"] = None, False
    if key != active:
        model_state["active"] = key
        if model_state["error_key"] == key:
            model_state["error"] = model_state["error_key"] = None
    if not model_state["loading"]:
        _drop_others(key)                             # the old model goes once the new one paints
    return key


def dream(key, img, prompt, strength, steps, seed, pose=None, pose_scale=0.8, edges=0.0, look=None, **drift):
    key = use_model(key)
    kinds = tuple(k for k, on in (("pose", pose is not None), ("edges", edges > 0)) if on)
    if kinds:
        control_pipeline(key, kinds)
    return _render(key, img, prompt, strength, steps, seed, pose, pose_scale, edges=edges, look=look, **drift), key


# ---------- pictures and clips on request (picture generator, #56) ----------
_t2i: dict = {}
_full_vae: dict = {}


def _maker(key):
    """Text-to-image pipeline sharing the weights of the live pipeline (no extra download, no extra memory)."""
    p = pipeline(key)
    if key in _t2i and key in _full_vae:              # #187: built already – no lock
        return _t2i[key]
    with _build_lock:
        if key not in _t2i:
            from diffusers import AutoPipelineForText2Image
            t = AutoPipelineForText2Image.from_pipe(p)
            t.set_progress_bar_config(disable=True)
            _t2i[key] = t
        if key not in _full_vae:                  # the full decoder draws finer detail than the live one (SD only:
            _full_vae[key] = None                 # the SDXL decoder turns black in fp16 on the Mac)
            if not MODELS[key][2]:
                try:
                    from diffusers import AutoencoderKL
                    with _load_lock:
                        _full_vae[key] = AutoencoderKL.from_pretrained(
                            MODELS[key][0], subfolder="vae", torch_dtype=dtype, local_files_only=True,
                            variant="fp16" if dtype == torch.float16 else None).to(device)
                except Exception as e:            # not in the cache: the live decoder will do
                    print(f"full VAE for {key} not available ({type(e).__name__}); using the fast one", flush=True)
    return _t2i[key]


@contextlib.contextmanager
def _decoder(p, key):
    """Uses the full decoder for one call, then gives the pipeline its fast decoder back."""
    full = _full_vae.get(key)
    if full is None:
        yield
        return
    fast = p.vae
    p.vae = full
    try:
        yield
    finally:
        p.vae = fast


def make_picture(key, prompt, w, h, seed, refine=True, steps=4):
    """One picture from text: 4 steps at the live size, then a light pass at 1.5× size for detail.
    #160: steps=1 for a quick sketch (a Dreamy Eyes mask) that holds the stage only a moment."""
    key = key if _ready(key) else (model_state["active"] or key)
    key = key if key in MODELS else "sd-turbo"
    t = _maker(key)
    gen = torch.Generator(device="cpu").manual_seed(seed)
    t0 = time.time()
    try:
        with gpu_lock, torch.no_grad(), _decoder(t, key):
            img = t(prompt=prompt, width=w, height=h, num_inference_steps=steps, guidance_scale=0.0,
                    generator=gen, output_type="pil").images[0]
        if refine:
            big = img.resize((int(w * 1.5) // 8 * 8, int(h * 1.5) // 8 * 8), Image.LANCZOS)
            p = _pipes[key]
            with gpu_lock, torch.no_grad(), _decoder(p, key):
                img = p(prompt=prompt, image=big, strength=0.3, num_inference_steps=4, guidance_scale=0.0,
                        generator=torch.Generator(device="cpu").manual_seed(seed), output_type="pil").images[0]
        return img
    finally:
        _busy["t"] += time.time() - t0
        _busy["n"] += 1


def _step_view(img, zoom, rot):
    """The next camera position of a clip: a little closer and turned (same size)."""
    w, h = img.size
    out = img.rotate(rot, resample=Image.BICUBIC, expand=False, fillcolor=None)
    dx, dy = w * zoom / 2, h * zoom / 2
    return out.crop((dx, dy, w - dx, h - dy)).resize((w, h), Image.BICUBIC)


def _view_at(img, zoom, rot, i):
    """The picture as seen after i camera steps (for anchoring the clip to its first picture)."""
    w, h = img.size
    scale = (1 - zoom) ** i
    out = img.rotate(rot * i, resample=Image.BICUBIC)
    dx, dy = w * (1 - scale) / 2, h * (1 - scale) / 2
    return out.crop((dx, dy, w - dx, h - dy)).resize((w, h), Image.BICUBIC)


def make_clip(key, start, prompt, frames, zoom, rot, strength, seed, emit):
    """A clip from a picture: the view moves in while the dream keeps painting. Each frame grows out of the one
    before (smooth), held half-way to the first picture seen from the same place (no drift into mush)."""
    key = key if _ready(key) else (model_state["active"] or key)
    key = key if key in MODELS else "sd-turbo"
    pipeline(key)
    img = start
    for i in range(1, frames + 1):
        moved = Image.blend(_step_view(img, zoom, rot), _view_at(start, zoom, rot, i), 0.5)
        img = _render(key, moved, prompt, strength, 4, seed)
        emit(i - 1, img)


def _jpeg(img, q=92) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q)
    return buf.getvalue()


for k in [m for m in os.environ.get("DREAM_PRELOAD", "").split(",") if m in MODELS]:
    pipeline(k)

app = FastAPI()


@app.middleware("http")
async def _language(request, call_next):
    """#132: answers (errors, cloud messages) in the language of the page that asks (its cookie)."""
    token = i18n.current.set(i18n.from_cookie(request.cookies.get("dream-lang")))
    try:
        return await call_next(request)
    finally:
        i18n.current.reset(token)
print(f"Dream ({ROLE}) on {device}.", flush=True)


@app.get("/health")
def health():
    return {"role": ROLE, "device": device, "models": sorted(_pipes)}


_stats_last = {"t": time.time(), "busy": 0.0, "n": 0}


@app.get("/stats")
def stats():
    """Load of this Mac for the panel: pictures per second, share of time the image AI is busy, CPU and memory."""
    now = time.time()
    dt = max(now - _stats_last["t"], 1e-3)
    out = {"ai_fps": round((_busy["n"] - _stats_last["n"]) / dt, 1),
           "ai_busy": round(min(1.0, (_busy["t"] - _stats_last["busy"]) / dt) * 100),
           "device": device, "models": sorted(_pipes), "model": model_state["active"],
           "loading": model_state["loading"], "model_error": model_state["error"],
           "first_download": bool(model_state.get("first"))}   # #179
    _stats_last.update(t=now, busy=_busy["t"], n=_busy["n"])
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
    try:
        if device == "mps":
            out["gpu_mem_gb"] = round(torch.mps.driver_allocated_memory() / 1e9, 1)
    except Exception:
        pass
    return out


@app.websocket("/ws")
async def ws(sock: WebSocket):
    """Protocol: a JSON text message with the settings, then a binary JPEG frame; answer: JPEG + timing JSON.
    With a pose, the binary message is b"DRM2" + 4-byte length of the frame JPEG + frame JPEG + skeleton JPEG."""
    guard_ws = globals().get("render_allowed")   # #148: rendering is for the stage, not for guests
    if guard_ws and not guard_ws(sock):
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
                        perf_add("decode_in", (time.perf_counter() - t_dec) * 1000)   # #180
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
            perf_add("queue", (t0 - t_in) * 1000)            # #180: how long the frame waited before rendering
            drift = {"seed2": int(fs["seed2"]) if fs.get("seed2") is not None else None,
                     "st": float(fs.get("st") or 0), "pt": float(fs.get("pt") or 0),
                     "prompt2": str(fs["prompt2"])[:500] if fs.get("prompt2") else None}
            try:
                out, used = await loop.run_in_executor(None, lambda: dream(
                    str(fs["model"]), img, str(fs["prompt"])[:500], float(fs["strength"]), int(fs["steps"]), int(fs["seed"]),
                    pose, float(fs.get("pose_scale", 0.8)), float(fs.get("edges") or 0),
                    {"style": str(fs.get("style") or ""), "sa": float(fs.get("sa") or 0),
                     "ref": str(fs.get("ref") or ""), "ra": float(fs.get("ra") or 0)}, **drift))
            except Exception as e:                     # #177: never swallowed – logged, and the stage is told what to do
                print("render error:", repr(e)[:300], flush=True)
                oom = "out of memory" in str(e).lower()
                if oom:
                    gc.collect()
                    with contextlib.suppress(Exception):
                        torch.mps.empty_cache() if device == "mps" else torch.cuda.empty_cache()
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

            async def send(prev, out=out, gpu_ms=gpu_ms, switch=switch, t_in=t_in, used=used, fmt=fs.get("fmt")):
                t_enc = time.perf_counter()
                jpg = await loop.run_in_executor(None, encode, out, fmt)
                perf_add("encode_out", (time.perf_counter() - t_enc) * 1000)   # #180
                if prev:
                    await asyncio.gather(prev, return_exceptions=True)   # the answers leave in the order the frames came
                if switch:
                    await sock.send_text(json.dumps({"switch": switch}))
                t_send = time.perf_counter()
                await sock.send_bytes(jpg)
                perf_add("send", (time.perf_counter() - t_send) * 1000)
                perf_add("server", (time.time() - t_in) * 1000)
                await sock.send_text(json.dumps({"ms": gpu_ms, "server_ms": int((time.time() - t_in) * 1000), "device": device,
                                                 "model": used, "loading": model_state["loading"], "error": model_state["error"],
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
    guard_ws = globals().get("render_allowed")   # #148: rendering is for the stage, not for guests
    if guard_ws and not guard_ws(sock):
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
            pic = await loop.run_in_executor(None, lambda: make_picture(key, prompt, w, h, seed, refine=kind == "img"))
            await sock.send_text(json.dumps({"type": "pic", "n": 0, "of": 1}))
            await sock.send_bytes(_jpeg(pic))
            start = pic.resize((w, h), Image.LANCZOS)
        if kind == "clip":
            frames = min(120, max(12, int(req.get("frames") or 48)))
            zoom = min(0.03, max(-0.03, float(req.get("zoom") or 0.006)))
            rot = min(2.0, max(-2.0, float(req.get("rot") or 0.15)))
            strength = min(0.6, max(0.15, float(req.get("strength") or 0.25)))
            out = asyncio.Queue()

            def emit(i, img):
                loop.call_soon_threadsafe(out.put_nowait, (i, _jpeg(img, 90)))

            job = loop.run_in_executor(None, lambda: make_clip(key, start, prompt, frames, zoom, rot, strength, seed, emit))
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


if ROLE == "app":
    app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")

    @app.get("/")
    def index():
        return FileResponse(os.path.join(HERE, "static", "index.html"))

    def to_english_prompt(text: str) -> str:
        """Asks a small local Ollama model for a short English image prompt; falls back to the transcript."""
        body = json.dumps({"model": PROMPT_MODEL, "stream": False, "options": {"temperature": 0.4},
                           "prompt": "Rewrite the following as one short, vivid English prompt for an image generator "
                                     "(max 30 words, visual details only, no quotes, no explanation):\n\n" + text}).encode()
        try:
            req = urllib.request.Request(OLLAMA + "/api/generate", data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                out = json.load(r).get("response", "").strip().strip('"')
            return out or text
        except Exception:
            return text

    # MLX binds its GPU stream to the thread that loaded the model, so Whisper always runs on this one thread
    # (the default executor picks any thread: "There is no Stream(gpu, 1) in current thread").
    _whisper_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="whisper")

    def transcribe(path: str) -> dict:
        import mlx_whisper
        return mlx_whisper.transcribe(path, path_or_hf_repo=WHISPER)

    # ---------- energy words: what "calm" and "wild" mean for the current prompt (direct touch, part C) ----------
    _energy_cache: dict = {}
    ENERGY_FALLBACK = {"calm": "calm, still, soft gentle light", "wild": "wild storm, bursting sparks, explosive motion"}

    def energy_words(prompt: str) -> dict:
        ask = ("For this image prompt, give two short English additions of 3 to 6 words: one that makes the scene "
               "calm and still, one that makes the same scene wild and energetic, using elements that belong to it "
               "(for an ocean: calm = 'glassy calm sea, soft mist', wild = 'raging storm, crashing waves, foam').\n"
               "Prompt: " + prompt + "\nAnswer exactly in two lines:\ncalm: ...\nwild: ...")
        body = json.dumps({"model": PROMPT_MODEL, "stream": False, "options": {"temperature": 0.5}, "prompt": ask}).encode()
        try:
            req = urllib.request.Request(OLLAMA + "/api/generate", data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:
                text = json.load(r).get("response", "")
        except (OSError, ValueError):
            return {**ENERGY_FALLBACK, "source": "fallback"}
        out = {}
        for line in text.splitlines():
            k, _, v = line.partition(":")
            k = k.strip().strip("*").lower()
            if k in ("calm", "wild") and v.strip():
                out[k] = v.strip().strip('"').strip("'")[:80]
        if len(out) < 2:
            return {**ENERGY_FALLBACK, "source": "fallback"}
        return {**out, "source": "model"}

    @app.get("/energy_words")
    async def energy_words_get(p: str = ""):
        p = p.strip()[:300]
        if not p:
            return ENERGY_FALLBACK
        if p not in _energy_cache:
            if len(_energy_cache) > 50:
                _energy_cache.pop(next(iter(_energy_cache)))
            _energy_cache[p] = await asyncio.get_running_loop().run_in_executor(None, energy_words, p)
        return _energy_cache[p]

    @app.post("/voice")
    async def voice(audio: UploadFile = File(...), rewrite: str = Form("1")):
        # Always answer JSON with an "error" code the page can show: an HTML error page makes Safari's
        # response.json() fail with "The string did not match the expected pattern".
        data = await audio.read()
        if len(data) < 1000:
            return JSONResponse({"error": "too_short"}, status_code=422)
        suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data)
            path = f.name
        try:
            res = await asyncio.get_running_loop().run_in_executor(_whisper_pool, transcribe, path)
            text = (res.get("text") or "").strip()
        except Exception as e:
            unreadable = "Failed to load audio" in str(e)
            print(f"Voice: {'unreadable audio' if unreadable else 'transcription failed'} "
                  f"({audio.content_type}, {len(data)} bytes): {str(e).splitlines()[0][:200]}", flush=True)
            return JSONResponse({"error": "unreadable" if unreadable else "failed"},
                                status_code=422 if unreadable else 500)
        finally:
            os.remove(path)
        prompt = (await asyncio.get_running_loop().run_in_executor(None, to_english_prompt, text)
                  if (text and rewrite == "1") else text)
        return JSONResponse({"text": text, "prompt": prompt})

    # ---------- Scaleway GPU, through ./dream-cloud ----------
    _job = {"proc": None, "log": os.path.join(tempfile.gettempdir(), "dream-cloud.log"), "action": ""}

    def cloud_failure(log: str) -> dict | None:
        """Why the last start failed (#98), told plainly: the GPU quota, or dream-cloud's own error line."""
        p = _job["proc"]
        if _job["action"] != "start" or p is None or p.poll() in (None, 0):
            return None
        m = re.search(r"quota exceeded for resources? '?cp_servers_type_([A-Za-z0-9_]+)", log)
        if m:
            zone = (re.search(r" in (\S+)(?: an)? \([Ii]mage", log) or [None, ""])[1]
            return {"kind": "quota", "type": m.group(1).replace("_", "-"), "zone": zone}
        # dream-cloud and cloud_runpod.py mark their errors with "✖ " (#132; the German "Fehler:" of earlier versions)
        err = [ln.split(" ", 1)[-1].strip() for ln in log.splitlines() if ln.startswith(("✖ ", "Fehler:"))]   # German marker of earlier versions
        last = (err or log.strip().splitlines() or [i18n.t("unknown")])[-1]
        return {"kind": "error", "text": last[:200]}

    # #176: the cloud's status is found out here, once for everybody, and pushed to Dream Control and this Mac –
    # instead of every remote asking every few seconds (each question starts `dream-cloud status`). Often while a GPU
    # starts, stops or runs, rarely while it is off, hardly at all while no provider is set up.
    cloud_cache: dict = {"st": None, "kick": False}

    async def cloud_watch():
        loop = asyncio.get_running_loop()
        while True:
            cloud_cache["kick"] = False
            st = await loop.run_in_executor(None, cloud_read)
            if st != cloud_cache["st"]:
                cloud_cache["st"] = st
                for c, r in list(roles.items()):
                    if r in ("local", "control"):
                        outbox.post(c, json.dumps({"cloud": st}))
            active = st.get("busy") or st.get("state") not in ("off", "setup", "error") or state.get("backend") == "cloud"
            wait = 3 if active else 300 if st.get("state") == "setup" else 30
            for _ in range(wait):
                if cloud_cache["kick"]:
                    break
                await asyncio.sleep(1)

    app.router.on_startup.append(lambda: live.setdefault("cloud_watch", asyncio.get_event_loop().create_task(cloud_watch())))

    # ---------- a measurement run (#180): 60 s with fixed settings, the parts of a picture and the devices' frames ----------
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
        before = {k: state[k] for k in MEASURE_FIXED} if fixed else None
        try:
            if fixed:
                await apply(MEASURE_FIXED, by="measure")
                await asyncio.sleep(4)                 # settle: the stage takes the settings, the model is ready
            measure["reports"] = {}
            _perf.update(on=True, steps={}, frames=0)
            t0 = time.time()
            msg = {"measure": {"ms": seconds * 1000}}
            await broadcast(msg)
            await eyes_send(msg)
            await asyncio.sleep(seconds)
            _perf["on"] = False
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
            st = stats()
            r = {"at": time.strftime("%Y-%m-%d %H:%M:%S"), "seconds": seconds, "fixed": fixed, "device": device,
                 "backend": state.get("backend"), "model": model_state.get("active") or state.get("model"),
                 "size": f"{state.get('size')}px", "ai_steps": state.get("quality"),
                 "fps": round(_perf["frames"] / max(dt, 1e-3), 2), "frames": _perf["frames"],
                 "steps": {k: _summary(v) for k, v in _perf["steps"].items()}, "devices": devices,
                 "gpu_mem_gb": st.get("gpu_mem_gb"), "mem_dream_gb": st.get("mem_dream_gb")}
            r["table"] = measure_table(r)
            print(r["table"], flush=True)
            with contextlib.suppress(OSError):
                os.makedirs(os.path.join(STATE_DIR, "measure"), exist_ok=True)
                with open(os.path.join(STATE_DIR, "measure", time.strftime("%Y%m%d-%H%M%S") + ".json"), "w") as f:
                    json.dump(r, f, indent=1)
            measure["last"] = r
            await broadcast({"measure_result": r})
        finally:
            _perf["on"] = False
            measure["run"] = None
            if before:
                await apply(before, by="measure")

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

    @app.get("/cloud")
    def cloud_status():
        """Dream Control and this Mac only (#176): the latest status the watcher found."""
        cloud_cache["kick"] = cloud_cache["st"] is None
        return cloud_cache["st"] or cloud_read()

    def cloud_read() -> dict:
        busy = _job["proc"] is not None and _job["proc"].poll() is None
        try:
            r = subprocess.run([CLOUD, "status", "--json"], capture_output=True, text=True, timeout=40)
            st = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else \
                {"state": "error", "error": (r.stderr or r.stdout).strip()[-300:]}
        except Exception as e:
            st = {"state": "error", "error": str(e)[:300]}
        st["busy"] = busy
        try:
            with open(_job["log"]) as f:
                st["log"] = f.read()[-1500:]
        except FileNotFoundError:
            st["log"] = ""
        fail = cloud_failure(st["log"])
        if fail and st.get("state") == "off":
            st["fail"] = fail
        return st

    def _spawn(*args):
        if _job["proc"] is not None and _job["proc"].poll() is None:
            return False
        logf = open(_job["log"], "w")
        env = {**os.environ, "DREAM_LANG": i18n.current.get() or i18n.fallback["lang"]}   # #132: its messages in the page's language
        _job["proc"] = subprocess.Popen([CLOUD, *args], stdout=logf, stderr=subprocess.STDOUT, env=env)
        _job["action"] = args[0]
        return True

    @app.post("/cloud/start")
    def cloud_start(gpu: str = Form("L4-1-24G"), model: str = Form("sd-turbo"), fallback: str = Form("")):
        extra = ["--fallback", fallback] if fallback else []   # #110: only what the owner agreed to, with its price
        if model == "sdxl-turbo" and state.get("style_ref"):   # #131: a reference picture in use: compile with its adapter
            extra.append("--with-ref")
        started = _spawn("start", "--type", gpu, "--model", model, *extra)
        cloud_cache["kick"] = True                     # #176: look again at once
        return {"started": started}

    @app.post("/cloud/stop")
    def cloud_stop():
        if _job["proc"] is not None and _job["proc"].poll() is None:
            _job["proc"].terminate()
            _job["proc"].wait(timeout=10)
        stopping = _spawn("stop")
        cloud_cache["kick"] = True                     # #176
        return {"stopping": stopping}

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


    # ---------- shared control state: the stage and any number of remotes (phones) ----------
    # The stage (index.html) renders; remotes (remote.html) only change settings. Every change goes to the
    # server and from there to all other clients. The state survives restarts (state.json), so an
    # installation comes back exactly as it was.
    import secrets
    import socket
    import uuid

    from fastapi import Request
    from fastapi.responses import Response

    STATE_DIR = paths.state_dir()                              # #186: DREAM_STATE_DIR, default ~/.local/state/dream
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    STATE_FILE = os.path.join(STATE_DIR, "state.json")
    TOKEN_FILE = os.path.join(STATE_DIR, "remote-token")      # #148: the guests' key (Dream Remote, the stage's QR code)
    CONTROL_FILE = os.path.join(STATE_DIR, "control-token")   # #148: the key of Dream Control (full rights)
    EYES_FILE = os.path.join(STATE_DIR, "eyes-token")         # #156: the key of Dreamy Eyes (only its front camera)
    WINDOW_FILE = os.path.join(STATE_DIR, "window-token")     # #201: the key of the dream windows (they only look)
    MEDIA_DIR = os.path.join(STATE_DIR, "media")
    os.makedirs(MEDIA_DIR, exist_ok=True)
    LAN = os.environ.get("DREAM_LAN") == "1"
    PORT = int(os.environ.get("DREAM_PORT", "7860"))
    # #145: Dream Control over https. #153: never 7861 – that is the cloud GPU's SSH tunnel (dream-cloud LOCAL_PORT).
    CLOUD_TUNNEL_PORT = 7861
    HTTPS_PORT = int(os.environ.get("DREAM_HTTPS_PORT", "7443"))
    TLS_DIR = os.path.join(STATE_DIR, "tls")
    tls_state = {"on": False, "error": ""}

    def _key(path: str, renew: bool = False) -> str:
        if renew or not os.path.exists(path):
            with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
                f.write(secrets.token_urlsafe(12))
        with open(path) as f:
            return f.read().strip()
    keys = {"guest": _key(TOKEN_FILE), "control": _key(CONTROL_FILE), "eyes": _key(EYES_FILE), "window": _key(WINDOW_FILE)}

    # #148: what a guest (Dream Remote) may change; everything else needs Dream Control or this Mac. Enforced here, in
    # the server: the remote page only hides what a guest cannot use.
    # owner's decision (2026-11-18): painting, touching, directness, impulses, movement reaction, the pose and the music
    # automatic/drop are the performer's – not a guest's; nor are "New" (the dream starts anew) and the QR on the stage
    # … and (same day) neither removing the owner's picture or video, the rest of the movement card, nor the playlist
    GUEST_KEYS = {"prompt", "strength", "mix", "zoom", "rot", "hue", "drift", "smooth", "drift_prompt", "seed", "mode",
                  "fx", "fx_amt", "fx_beat", "style", "style_amt", "sens", "music_pattern"}
    GUEST_CMDS = {"next", "tap", "tapoff", "make", "fx"}
    GUEST_MODES = {"dream", "img", "vid"}          # the Mac's camera (cam, flow) only on Control's or the stage's word

    def guest_changes(changes: dict) -> dict:
        """#148: the part of a guest's changes a guest may make."""
        return {k: v for k, v in changes.items()
                if k in GUEST_KEYS and (k != "mode" or v in GUEST_MODES)}

    DEFAULT_STATE = {
        "prompt": "psychedelic kaleidoscope of glowing fractal flowers, vivid neon colors, intricate, dreamy",
        "mode": "dream", "backend": "local", "model": "sd-turbo", "running": True,
        "strength": 0.5, "mix": 0.35, "zoom": 0.018, "rot": 0.6, "hue": 4.0, "sens": 1.0,
        "quality": 2, "size": 512, "seed": 1, "music": "off", "rewrite": True,
        "playlist": "", "interval": 45, "shuffle": False,          # installation: prompt playlist
        "motion": True, "motion_sens": 1.0,                        # flowtrack movement (OSC) steers the dream
        "syphon": False,                                           # publish the stage picture as Syphon source "Dream"
        "pose": False, "pose_scale": 0.8,                          # the dancer's skeleton (flowtrack) shapes the figure
        "flowtrack": "off",                                        # movement detection on the stage: off | on (light) | hand (pose)
        "flow_kind": "hand",                                       # what the flowtrack switch turns on: on | hand
        "drift": 0.5, "drift_prompt": True,                        # keeps the dream alive without new input (0 = off)
        "music_patterns": True, "music_drop": True,                # music: changing patterns, drop → next scene
        "beat_snap": "bar",                                        # #195: changes snap to the beat: off | beat | bar | phrase
        "smooth": 0.3,                                             # smoothing: moving average of the shown pictures (0 = off)
        "morph": 1.0,                                              # #194: motion between two AI pictures (0 = off)
        "music_pattern": "auto",                                   # auto, or a fixed pattern (Pulse, Jolt, Jump, Flow)
        "aspect": "square",                                        # picture format: square | wide (16:9)
        "touch_amt": 0.6, "touch_paint": True, "touch_warp": True,  # direct touch: hands paint and stir the dream
        "touch_mirror": False, "touch_content": True, "touch_impulse": True, "touch_light": False,
        "master": 1.0,                                             # master brightness (MIDI fader, blackout): 0 = black
        "auto": False, "auto_level": 0.5,                          # autopilot steers Dream by itself, led by the music
        "auto_media": True, "auto_cam": False, "auto_flow": False, "ap_words": True,  # … also makes pictures/clips; camera/flowtrack only if allowed
        "cam_device": "", "flow_device": "",
        "calib": "",                                               # camera → picture calibration (#92): JSON {h, delay}
        "flow_unproject": False,
        "fast": False, "fast_prev": "",
        "edges": False, "edges_scale": 0.8,
        "flow_color": "", "flow_short": True,
        "style": "", "style_amt": 1.0,                             # #123: a style model (SDXL-Turbo) and its strength (0–2)
        "style_ref": "", "style_ref_amt": 0.8,                     # #123: a style reference picture (id) and its strength
        "fx": "", "fx_amt": 0.7, "fx_beat": True,                  # effects by hand: "tunnel+waves", their strength, pulse on the beat
    }
    # #175: the range of every number a device may set (the sliders' ranges; MIDI's targets are the same) – a value
    # outside is clamped, NaN or Inf is refused, so nobody can poison the saved state
    RANGES = {**midi.TARGETS, "quality": (1, 4), "size": (256, 1024), "seed": (0, 2**31 - 1), "interval": (5, 3600),
              "auto_level": (0.0, 1.0), "edges_scale": (0.2, 1.5), "style_amt": (0.0, 2.0), "style_ref_amt": (0.0, 1.0),
              "touch_amt": (0.0, 1.0), "morph": (0.0, 1.0)}

    def coerce_number(k, v):
        """#175: a number of the default's type, finite and inside its range – or ValueError."""
        d = DEFAULT_STATE[k]
        if isinstance(v, bool) or not isinstance(v, (int, float, str)):
            raise ValueError(k)
        f = float(str(v)[:40]) if isinstance(v, str) else float(v)
        if not math.isfinite(f):
            raise ValueError(k)
        lo, hi = RANGES.get(k, (-1e6, 1e6))
        f = min(max(f, lo), hi)
        return int(round(f)) if isinstance(d, int) else f

    state = dict(DEFAULT_STATE)
    try:
        with open(STATE_FILE) as f:
            saved = json.load(f)
        for k, v in saved.items() if isinstance(saved, dict) else ():
            if k in DEFAULT_STATE:
                with contextlib.suppress(ValueError, TypeError, OverflowError):   # #175: a broken value heals to the default
                    state[k] = coerce_number(k, v) if isinstance(DEFAULT_STATE[k], (int, float)) and not isinstance(DEFAULT_STATE[k], bool) else v
    except (FileNotFoundError, ValueError):
        pass
    # #133: values saved by earlier, German versions in today's English
    state["playlist"] = playlists.new_name(str(state["playlist"]))
    state["music_pattern"] = playlists.OLD_PATTERNS.get(state["music_pattern"], state["music_pattern"])
    state["style"] = playlists.OLD_STYLES.get(state["style"], state["style"])
    # the movement switch ("flowtrack": off | on | hand) is remembered like every other setting (#90)
    state["backend"] = "local"        # #102: every start computes on this Mac; the cloud (it costs) only when chosen
    if state.get("cam_device") == "device":          # #146: a device's live camera never outlives the run it was sent in
        state["cam_device"] = ""
        if state.get("mode") == "cam":
            state["mode"] = "dream"
    live = {"fps": 0.0, "stages": 0, "remotes": 0, "scene_at": time.time(), "index": -1}
    clients: dict = {}          # WebSocket -> "stage" | "remote"
    roles: dict = {}            # #148: control socket -> what it may do now: "local" | "control" | "guest"
    key_roles: dict = {}        # #148: socket (control, output, preview) -> the role its key gives
    feeds: dict = {"cam": None, "motion": None}   # #146: the one device that sends its live camera / its motion
    feed_info: dict = {}        # #146: kind -> what the stage shows about it ({"facing": "user" | "environment"})
    viewers: set = set()        # output windows (/output): they only show what the stage shows
    previews: dict = {}         # #141: small live previews on remotes and Dreamy Eyes – socket → "small" | "full" (#187)
    shown = {"frame": None}     # the last picture the stage showed (JPEG)

    temp_lists: dict = {}       # AI playlists of this run: only in memory, gone after a restart

    def load_playlists() -> dict:
        return playlists.load(HERE, temp_lists)

    def playlist_names() -> list:
        return playlists.names(HERE, temp_lists)

    def save_state():
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f, ensure_ascii=False, indent=1, allow_nan=False)   # #175: never NaN on disk
        os.replace(tmp, STATE_FILE)

    # #187: a slider that is dragged changes the state about 15 times a second. The file is written once the hands
    # rest (SAVE_AFTER seconds after the last change), during a long drag at least every SAVE_LATEST seconds, and when
    # Dream is stopped.
    SAVE_AFTER, SAVE_LATEST = 1.0, 5.0
    saving: dict = {"timer": None, "since": 0.0}

    def save_soon():
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:                         # no event loop (a script, a test): write right away
            save_state()
            return
        now = time.monotonic()
        if saving["timer"] is None:
            saving["since"] = now
        else:
            saving["timer"].cancel()
        wait = max(0.0, min(SAVE_AFTER, saving["since"] + SAVE_LATEST - now))
        saving["timer"] = loop.call_later(wait, save_now)

    def save_now():
        """Writes what save_soon put off (also when Dream stops)."""
        timer, saving["timer"] = saving["timer"], None
        if timer is None:
            return
        timer.cancel()
        try:
            save_state()
        except (OSError, ValueError) as e:           # a full disk must not end the show; the next change tries again
            print("state not saved:", repr(e)[:200], flush=True)

    app.router.on_shutdown.append(save_now)

    def lan_ip() -> str:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("192.0.2.1", 9))      # no packet is sent; only picks the outgoing interface
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"
        finally:
            s.close()

    def remote_url() -> str:
        return f"http://{lan_ip()}:{PORT}/remote?k={keys['guest']}"

    def control_url() -> str:
        """#148: Dream Control – the full remote; only shown on this Mac. #145: over https once the certificate stands."""
        if tls_state["on"]:
            return f"https://{lan_ip()}:{HTTPS_PORT}/control?k={keys['control']}"
        return f"http://{lan_ip()}:{PORT}/control?k={keys['control']}"

    def window_url() -> str:
        """#201: a dream window – plain http (it needs no camera), so older devices without the certificate work too."""
        return f"http://{lan_ip()}:{PORT}/window?k={keys['window']}"

    def eyes_url() -> str:
        """#156: Dreamy Eyes – the camera needs https (the browser gives it out only there)."""
        if tls_state["on"]:
            return f"https://{lan_ip()}:{HTTPS_PORT}/eyes?k={keys['eyes']}"
        return f"http://{lan_ip()}:{PORT}/eyes?k={keys['eyes']}"

    def ca_url() -> str:
        """#145: the certificate of Dream's own authority, to install once per device (public: no key needed)."""
        return f"http://{lan_ip()}:{PORT}/dream-ca.crt"

    def local_hostnames() -> list[str]:
        names = [socket.gethostname()]
        if sys.platform == "darwin":
            with contextlib.suppress(Exception):
                names.insert(0, subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True, text=True,
                                               timeout=3).stdout.strip() + ".local")
        return [n for n in names if n.lower().endswith(".local")]

    async def https_serve():
        """#145: a second listener with TLS in this process (same state, same app); http stays for the guests."""
        import uvicorn
        import tls
        if HTTPS_PORT in (PORT, CLOUD_TUNNEL_PORT):    # #153: would take the port of the panel or the cloud tunnel
            tls_state["error"] = i18n.t("Port {port} is taken by Dream itself – choose another DREAM_HTTPS_PORT.", port=HTTPS_PORT)
            print("https:", tls_state["error"], flush=True)
            return
        try:
            cert, key = await asyncio.to_thread(tls.ensure_server, TLS_DIR, [lan_ip()], local_hostnames())
        except Exception as e:
            tls_state["error"] = str(e)[:200]
            print("https:", e, flush=True)
            return

        class Listener(uvicorn.Server):
            @contextlib.contextmanager
            def capture_signals(self):                 # the main server owns Ctrl+C
                yield

        server = Listener(uvicorn.Config(app, host="0.0.0.0", port=HTTPS_PORT, ssl_certfile=cert, ssl_keyfile=key,
                                         lifespan="off", log_level="warning", ws_max_size=16 * 1024 * 1024))
        live["https_server"] = server
        tls_state["on"] = True
        print(i18n.t("Dream Control over https on port {port}.", port=HTTPS_PORT), flush=True)
        try:
            await server.serve()
        except (OSError, SystemExit) as e:
            print("https:", e, flush=True)
        finally:
            tls_state["on"] = False

    async def https_stop():
        """On Ctrl+C the https listener closes its connections itself, like the main server – instead of having its
        open sockets cancelled under it when the program ends (which printed long tracebacks)."""
        server, task = live.get("https_server"), live.get("https")
        if server:
            server.should_exit = True
        if task:
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await asyncio.wait_for(task, 5)

    if LAN:
        app.router.on_startup.append(lambda: live.setdefault("https", asyncio.get_event_loop().create_task(https_serve())))
        app.router.on_shutdown.append(https_stop)

    def output_url() -> str:
        """The output page for a second device at the beamer (the guests' key: it can only watch and steer like one)."""
        return f"http://{lan_ip()}:{PORT}/output?k={keys['guest']}"

    def is_local(host) -> bool:
        return host in ("127.0.0.1", "::1", "localhost", None)

    def role_of(host, query_k, cookie_k) -> str | None:
        """#148: "local" (this Mac), "control" (Dream Control), "guest" (Dream Remote), "eyes" (#156: Dreamy Eyes, a phone
        that only lends its front camera) or None (no access)."""
        if is_local(host):
            return "local"
        if not LAN:
            return None
        k = str(query_k or cookie_k or "")
        if secrets.compare_digest(k, keys["control"]):
            return "control"
        if secrets.compare_digest(k, keys["guest"]):
            return "guest"
        if secrets.compare_digest(k, keys["eyes"]):
            return "eyes"
        if secrets.compare_digest(k, keys["window"]):
            return "window"                           # #201: a dream window – it only looks
        return None

    def allowed(host, query_k, cookie_k) -> bool:
        return role_of(host, query_k, cookie_k) is not None

    # #148: what only Dream Control (or this Mac) may do, and what only the stage on this Mac hands in. Checked in the
    # middleware before a handler reads anything; a new route that costs money or changes the owner's files goes here.
    CONTROL_ONLY = [("POST", r"/cloud/(start|stop)"), ("GET", r"/cloud"), ("POST", r"/measure"), ("GET", r"/measure"), ("POST", r"/playlists"), ("DELETE", r"/playlists/.+"),
                    ("POST", r"/upload"), ("POST", r"/voice"), ("POST", r"/gallery/[^/]+/(delete|save)"),
                    ("POST", r"/gallery/clear"), ("POST", r"/gallery/undo/[^/]+"), ("POST", r"/style-ref")]
    LOCAL_ONLY = [("POST", r"/gallery")]
    # #175: everything a guest (Dream Remote, the output window on a second device) may ask over HTTP; the rest is for
    # Dream Control and this Mac – a new route is closed to guests until it is added here
    GUEST_HTTP = re.compile(r"GET /(remote|output|health|remote-info|cloud)|GET /static/[\w./-]+|GET /media/[^/]+"
                            r"|GET /style-ref/[^/]+|GET /mp/[\w./-]+|POST /gallery/[^/]+/use")

    def needs(method: str, path: str) -> set | None:
        """The roles that may make this request, or None when every role may."""
        if any(method == m and re.fullmatch(r, path) for m, r in LOCAL_ONLY):
            return {"local"}
        if any(method == m and re.fullmatch(r, path) for m, r in CONTROL_ONLY):
            return {"local", "control"}
        return None

    def only_control():
        return JSONResponse({"error": i18n.t("Only Dream Control may do this.")}, status_code=403)

    def cookie_name(scheme: str) -> str:
        """#145: cookies ignore the port – Control's key over https keeps its own cookie, a guest QR won't replace it."""
        return "dream_c" if scheme in ("https", "wss") else "dream_k"

    # #145: public, no key: the CA certificate (a device needs it first), the app manifests and icons (browsers fetch
    # them without cookies). Nothing in them is secret.
    PUBLIC = re.compile(r"/dream-ca\.crt|/static/(remote|control|eyes)\.webmanifest|/static/icons/[\w-]+\.(png|svg|ico)")
    # #156: all Dreamy Eyes may reach over http – its page and its files; the rest is closed to it (fail closed)
    WINDOW_PATHS = re.compile(r"/window|/static/[\w./-]+|/eyes/mask/[0-9a-f]{12}\.jpg")   # #201: all a dream window may ask
    EYES_PATHS = re.compile(r"/eyes|/eyes/mask/[0-9a-f]{12}\.jpg|/static/[\w./-]+|/mp/[\w./-]+")   # #157: /mp – face detection; #160: masks

    def cookie_of(cookies, scheme: str, eyes: bool = False, window: bool = False):
        """The key a device keeps: its own scheme's cookie, else the one of Dreamy Eyes (#156: a cookie of its own, so
        trying the eyes on the owner's phone never replaces Dream Control's key). #166: the eyes' page asks for the
        eyes' key first – a device that is Dream Control as well stays the eyes there (and gets its painted faces)."""
        name = cookie_used(cookies, scheme, eyes, window)
        return cookies.get(name) if name else None

    def cookie_used(cookies, scheme: str, eyes: bool = False, window: bool = False) -> str | None:
        """The name of the cookie whose key a request brings (see cookie_of). #201: a dream window has its own cookie."""
        if eyes and cookies.get("dream_e"):
            return "dream_e"
        if window and cookies.get("dream_w"):
            return "dream_w"
        return next((n for n in (cookie_name(scheme), "dream_e", "dream_w") if cookies.get(n)), None)

    APP_PAGES = {"/", "/control", "/remote", "/eyes", "/output", "/window"}

    def wants_page(request: Request) -> bool:
        return request.method == "GET" and request.url.path in APP_PAGES and "text/html" in request.headers.get("accept", "")

    def pair_page(request: Request) -> Response:
        """#170: no key (or no longer a valid one): a page to pair this device – scan the code inside the page or paste
        the link – instead of a bare text an installed app cannot do anything with."""
        import html as _html
        al = request.headers.get("accept-language", "").lower()   # the device's own language: it has no Dream cookie yet
        lang = next((x[:2] for x in re.split(r"[,;\s]+", al) if x[:2] in i18n.LANGS), None) or i18n.current.get() or i18n.fallback["lang"]
        tx = {
            "title": i18n.t("Pair with Dream", lang),
            "checking": i18n.t("Looking for this device's key …", lang),
            "lead": i18n.t("This device has no key for Dream yet – or its key is no longer valid.", lang),
            "scan": i18n.t("📷 Scan the QR code", lang),
            "stop": i18n.t("Stop the camera", lang),
            "paste": i18n.t("Or paste the link of the QR code:", lang),
            "pair": i18n.t("Pair", lang),
            "notLink": i18n.t("That is not a link of Dream with a key.", lang),
            "noCamera": i18n.t("No camera – allow it, or paste the link.", lang),
            "noScan": i18n.t("This browser cannot read QR codes itself: scan the code with the camera app instead. Once it has opened Dream in the browser, the installed app is paired as well.", lang),
            "where": "<b>" + _html.escape(i18n.t("Where the code is:", lang)) + "</b><br>" + "<br>".join(_html.escape(x) for x in (
                i18n.t("Dream Control: on the Mac in the panel under “Output” → 🎛 Dream Control.", lang),
                i18n.t("Dreamy Eyes: in Dream Control on the card “👀 Dreamy Eyes” (or on the Mac: panel → “Output” → 👀 Dreamy Eyes).", lang),
                i18n.t("Guests: press Q on the stage.", lang))),
        }
        page = (open(os.path.join(HERE, "static", "pair.html"), encoding="utf-8").read()
                .replace("__TEXTS__", json.dumps(tx, ensure_ascii=False).replace("</", "<\\/"))
                .replace("__LANG__", lang))
        return Response(page, status_code=403, media_type="text/html", headers={"Cache-Control": "no-store"})

    class _QuietKeys(logging.Filter):
        """#175: no key in the log (it may end up in an issue or a shared file), and none of the polling every second."""
        def filter(self, record):
            if isinstance(record.args, tuple):
                if record.name == "uvicorn.access" and len(record.args) >= 3 and re.match(r"/(stats|cloud|health)\b", str(record.args[2])):
                    return False
                record.args = tuple(re.sub(r"([?&]k=)[^&\s\"]+", r"\1…", a) if isinstance(a, str) else a for a in record.args)
            if isinstance(record.msg, str):
                record.msg = re.sub(r"([?&]k=)[^&\s\"]+", r"\1…", record.msg)
            return True

    for _name in ("uvicorn.access", "uvicorn.error"):
        logging.getLogger(_name).addFilter(_QuietKeys())

    @app.middleware("http")
    async def guard(request: Request, call_next):
        host = request.client.host if request.client else None
        qk = request.query_params.get("k")
        cookie = cookie_name(request.url.scheme)
        if not origin_ok(request.headers):            # #175: before anything else – also the public files
            return Response(i18n.t("Not from Dream's own pages."), status_code=403)
        if request.method == "GET" and PUBLIC.fullmatch(request.url.path):
            return await call_next(request)
        request.state.role = role_of(host, qk, cookie_of(request.cookies, request.url.scheme, request.url.path.startswith("/eyes"),
                                                         request.url.path.startswith("/window")))
        if request.state.role is None:
            if wants_page(request):
                return pair_page(request)
            return Response(i18n.t("No access. Please scan the QR code on the stage – or, for Dream Control, its code in the panel (Output)."), status_code=403)
        if request.state.role == "eyes" and wants_page(request) and request.url.path != "/eyes":
            # #170: a device that only has the eyes' key opens another page (e.g. the Dream Control app whose own cookie
            # stayed behind): the pairing page – it retries once (bringing a strict Control cookie along) or lets it pair
            return pair_page(request)
        if request.state.role == "eyes" and (request.method != "GET" or not EYES_PATHS.fullmatch(request.url.path)):
            return only_control()
        if request.state.role == "eyes" and qk:
            cookie = "dream_e"
        if request.state.role == "window":            # #201: a dream window may only look: its page, files, faces
            if request.method != "GET" or not WINDOW_PATHS.fullmatch(request.url.path):
                return pair_page(request) if wants_page(request) else only_control()
            if qk:
                cookie = "dream_w"
        need = needs(request.method, request.url.path)
        if need and request.state.role not in need:
            return only_control()
        if request.state.role == "guest" and not GUEST_HTTP.fullmatch(f"{request.method} {request.url.path}"):
            return only_control()                      # #175: a guest only what Dream Remote and the output need (fail closed)
        resp = await call_next(request)
        if qk and not is_local(host):
            # #168: "lax", not "strict" – an installed app opened from the home screen (or a link from another app) is a
            # navigation from outside; a strict cookie stays behind there and the app finds no key. Lax still keeps it
            # away from other sites' forms and requests.
            resp.set_cookie(cookie, qk, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 365,
                            secure=request.url.scheme == "https")
        elif not qk and not is_local(host) and wants_page(request):
            # #170: a key that works is renewed on every page – as "lax" (a cookie from before #168 was "strict") and for
            # another year
            used = cookie_used(request.cookies, request.url.scheme, request.url.path.startswith("/eyes"))
            if used:
                resp.set_cookie(used, request.cookies[used], httponly=True, samesite="lax", max_age=60 * 60 * 24 * 365,
                                secure=request.url.scheme == "https")
        return resp

    def origin_ok(headers) -> bool:
        """#175: the request comes from Dream's own pages. The Host must name this Mac (an IP address, localhost or a
        .local name – a foreign domain is DNS rebinding), and an Origin, if sent, must be the same as the Host: a web page
        of another site open in a browser on this Mac may neither start the paid cloud GPU nor open /ctl with full
        rights. Fail closed."""
        hostport = headers.get("host", "")
        name = hostport.rsplit(":", 1)[0].strip("[]").lower() if not hostport.startswith("[") else hostport[1:].split("]")[0]
        try:
            ipaddress.ip_address(name)
        except ValueError:
            if name != "localhost" and not name.endswith(".local"):
                return False
        origin = headers.get("origin")
        if origin is None:
            return True                                # not sent by a browser page (curl, the stage's own requests)
        return origin.split("://", 1)[-1].rstrip("/").lower() == hostport.lower()

    def ws_role(sock: WebSocket) -> str | None:
        if not origin_ok(sock.headers):               # #175: a foreign page gets nothing
            return None
        host = sock.client.host if sock.client else None
        return role_of(host, sock.query_params.get("k"), cookie_of(sock.cookies, sock.url.scheme, sock.query_params.get("as") == "eyes",
                                                                   sock.query_params.get("as") == "window"))

    def ws_allowed(sock: WebSocket) -> bool:
        return ws_role(sock) is not None

    def render_allowed(sock: WebSocket) -> bool:
        return ws_role(sock) in ("local", "control")
    globals()["render_allowed"] = render_allowed

    async def broadcast(msg: dict, exclude=None, only=None):
        """To every control client. #187: only queued (outbox.py) – a slow device never holds up the others."""
        data = json.dumps(msg, ensure_ascii=False)
        for c, kind in list(clients.items()):
            if c is exclude or (only and kind != only) or roles.get(c) == "eyes":   # #156: the eyes learn nothing
                continue
            if not outbox.post(c, data):
                clients.pop(c, None)

    def status_msg() -> dict:
        live["stages"] = sum(1 for k in clients.values() if k == "stage")
        live["remotes"] = sum(1 for k in clients.values() if k == "remote")
        flow = round(live.get("flow_rate", 0)) if state["flowtrack"] != "off" else 0
        return {"live": {**{k: live[k] for k in ("fps", "stages", "remotes")}, "flowtrack": flow,
                         "viewers": len(viewers), "previews": len(previews), "windows": len(windows),
                         "midi": midi_ports}}

    CHOICES = {"mode": {"dream", "cam", "img", "vid", "flow"}, "backend": {"local", "cloud"},
               "model": set(MODELS), "music": {"off", "mic", "file"},
               "flowtrack": {"off", "on", "hand"}, "flow_kind": {"on", "hand"}, "aspect": {"square", "wide"},
               "music_pattern": {"auto", *playlists.PATTERNS}, "beat_snap": {"off", "beat", "bar", "phrase"}}

    def coerce(k, v):
        """Accepts a value only in the type (and, for choices, the values) of the default."""
        d = DEFAULT_STATE[k]
        if isinstance(d, bool):
            return bool(v)
        if isinstance(d, (int, float)):
            return coerce_number(k, v)
        v = str(v)[:2000]
        if k == "style":                               # #123: a known style model or none (#133: old German keys too)
            v = playlists.OLD_STYLES.get(v, v)
            return v if v in playlists.PICTURE_STYLES else ""
        if k == "music_pattern":
            v = playlists.OLD_PATTERNS.get(v, v)
        if k == "playlist":
            v = playlists.new_name(v)
        if k == "style_ref":                           # #123: a reference picture's id or none
            return v if re.fullmatch(r"[0-9a-f]{12}", v) else ""
        if k == "fx":                                  # only known effects, each once
            return "+".join(dict.fromkeys(e for e in v.split("+") if e in midi.FX))
        if k in CHOICES and v not in CHOICES[k]:
            raise ValueError(k)
        return v

    async def apply(changes: dict, exclude=None, persist=True, by=None):
        """by: who changed it by hand ("remote", "stage", "midi") – the autopilot leaves such settings alone a while."""
        clean = {}
        for k, v in changes.items():
            if k in DEFAULT_STATE:
                try:
                    clean[k] = coerce(k, v)
                except (ValueError, TypeError, OverflowError):   # #175: anything odd is simply not taken
                    pass
        if not clean:
            return
        if "playlist" in clean:
            live["index"] = -1
            live["scene_at"] = 0          # start the new playlist right away
        state.update(clean)
        if persist:
            save_soon()
        if "syphon" in clean:
            syphon_sync()
        if "backend" in clean:                         # #176: the cloud watcher looks more often now
            cloud_cache["kick"] = True
        if "master" in clean:                          # output windows dim with the stage
            for v in list(viewers):
                if not outbox.post(v, json.dumps({"master": state["master"]})):
                    viewers.discard(v)
        await broadcast({"set": clean, **({"by": by} if by else {})}, exclude=exclude)

    @app.websocket("/ctl")
    async def ctl(sock: WebSocket):
        if not ws_allowed(sock) or ws_role(sock) == "window":   # #201: a dream window only looks (/view)
            await sock.close(code=4403)
            return
        await sock.accept()
        outbox.box(sock)
        if not live.get("loop"):                       # the background loops start with the first client
            live["loop"] = asyncio.create_task(scene_loop())
            live["midi"] = asyncio.create_task(midi_loop())
            live["sensors"] = asyncio.create_task(sensor_loop())
            live["aimask"] = asyncio.create_task(aimask_loop())   # #160
        key_role = ws_role(sock)
        role = key_role
        if role == "control" and "control" in roles.values():
            role = "guest"                             # #148: one Dream Control at a time; this one may take over
        kind = "stage" if sock.query_params.get("role") == "stage" and key_role == "local" else "remote"
        clients[sock] = kind
        roles[sock], key_roles[sock] = role, key_role
        if sock.query_params.get("as") == "eyes" and key_role in ("eyes", "control", "local"):   # by its key, not its turn
            eyes_pages.add(sock)                       # #166: a Dreamy Eyes page, whatever key it came with
        lang = i18n.from_cookie(sock.cookies.get("dream-lang"))
        i18n.current.set(lang)
        if kind == "stage" and lang:                   # #132: what all see (MIDI, cloud) speaks the stage's language
            i18n.fallback["lang"] = lang
        outbox.post(sock, json.dumps(role_msg(sock)))
        outbox.post(sock, json.dumps(feeds_msg(sock) if role != "eyes" else {"feeds_mine": [], **aimask_msg()}))
        if sock in eyes_pages and role != "eyes":      # #166: a Dreamy Eyes page on a Control device gets the faces too
            outbox.post(sock, json.dumps(aimask_msg()))
        if sock in eyes_pages or role in ("eyes", "control", "local"):   # #172: how often the trance may come
            outbox.post(sock, json.dumps({"eyes_cfg": eyes_cfg}))
        if role in ("local", "control") and cloud_cache["st"]:   # #176: the cloud's latest status
            outbox.post(sock, json.dumps({"cloud": cloud_cache["st"]}))
        if role != "eyes":
            outbox.post(sock, json.dumps({"midi": {"map": midi_map}}))
            outbox.post(sock, json.dumps({"sensors": {"map": sens.mapping}}))
            outbox.post(sock, json.dumps({"state": state, "playlists": playlist_names(), "gallery": gallery_list(),
                                             "cams": live.get("cams", []), "lan": LAN, **status_msg()}, ensure_ascii=False))
        await broadcast(status_msg())
        bucket = [20.0, time.monotonic()]              # #175: a guest's message allowance
        try:
            while True:
                raw = await sock.receive()
                if raw.get("type") == "websocket.disconnect":
                    break
                if raw.get("bytes") is not None:      # #146: a picture of the live camera (only its device's)
                    await feed_frame(sock, raw["bytes"])
                    continue
                msg = json.loads(raw.get("text") or "null")
                if not isinstance(msg, dict):
                    continue
                if sock in eyes_pages or roles.get(sock) == "eyes":   # #166: also eyes on a Control device
                    eyes_note(msg)
                    if msg.get("eyes_mood") in WINDOW_MOODS:  # #201: the dream windows feel with the eyes
                        await windows_mood(msg["eyes_mood"])
                mr = msg.get("measure_report")             # #180: a device's frames during a measurement run
                if measure["run"] and isinstance(mr, dict) and len(measure["reports"]) < 50:
                    kind = mr.get("kind") if mr.get("kind") in ("stage", "eyes", "remote", "output") else "other"
                    with contextlib.suppress(TypeError, ValueError):
                        measure["reports"][(kind, id(sock))] = {
                            **{k: float(min(max(float(mr.get(k) or 0), 0), 10000)) for k in ("fps", "ms_avg", "ms_p95", "slow_pct")},
                            "render": mr.get("render") if mr.get("render") in ("webgl2", "canvas") else ""}
                if roles.get(sock) == "eyes":          # #156: Dreamy Eyes only lends (or stops) its front camera
                    f = msg.get("feed")
                    msg = {"feed": {"cam": bool(f.get("cam")), "facing": "user"}} if isinstance(f, dict) and "cam" in f else {}
                if msg.get("feed_end") in ("cam", "motion") and roles.get(sock) in ("control", "local"):
                    await feed_end_other(sock, msg["feed_end"])
                if "feed" in msg and isinstance(msg["feed"], dict):
                    await feed_set(sock, msg["feed"])
                if "motion_in" in msg and feeds["motion"] is sock and isinstance(msg["motion_in"], dict):
                    feed_motion(msg["motion_in"])
                if roles.get(sock) in ("control", "local"):   # #172: Dream Control sends the eyes into trance / sets how often
                    if msg.get("eyes_trance") is True:
                        await eyes_send({"trance": True})
                    ec = msg.get("eyes_cfg")
                    if isinstance(ec, dict) and ec.get("trance_every") in TRANCE_CHOICES:
                        eyes_cfg["trance_every"] = ec["trance_every"]
                        with contextlib.suppress(OSError):
                            os.makedirs(STATE_DIR, exist_ok=True)
                            with open(EYES_CFG_FILE, "w") as f:
                                json.dump(eyes_cfg, f)
                        await eyes_send({"eyes_cfg": eyes_cfg}, also_control=True)
                if msg.get("take_control") and key_roles.get(sock) == "control":
                    await take_control(sock)
                if msg.get("renew_guest") and key_role == "local":
                    await renew_guest()
                if roles.get(sock) == "guest":         # #148: a guest steers only the safe settings
                    now_m = time.monotonic()           # #175: and not faster than about 20 messages a second
                    bucket[0] = min(20.0, bucket[0] + (now_m - bucket[1]) * 20); bucket[1] = now_m
                    if bucket[0] < 1:
                        continue
                    bucket[0] -= 1
                    msg = {k: v for k, v in msg.items() if k in ("set", "cmd", "auto")}
                    if isinstance(msg.get("set"), dict):
                        msg["set"] = guest_changes(msg["set"])
                    if "cmd" in msg and msg["cmd"] not in GUEST_CMDS:
                        msg.pop("cmd")
                if "set" in msg and isinstance(msg["set"], dict):
                    await apply(msg["set"], exclude=sock, by=None if msg.get("auto") else kind)
                if "cmd" in msg:                       # one-off actions, handled by the stage
                    if msg["cmd"] == "next":
                        await next_scene(force=True)
                    else:
                        await broadcast({"cmd": msg["cmd"], "arg": msg.get("arg")}, exclude=sock)
                if "midi_learn" in msg:                # the next touched MIDI control gets this target
                    t = msg["midi_learn"]
                    midi_learn.clear()
                    if t in midi.TARGETS or t in midi.ACTIONS:
                        midi_learn["target"] = t
                if "sensor_learn" in msg and msg["sensor_learn"] in midi.TARGETS:
                    sens.start_learning(msg["sensor_learn"])
                if "sensor_forget" in msg or "sensor_invert" in msg or "sensor_impulse" in msg or "sensor_sens" in msg:
                    sensor_setting(msg)
                    await broadcast({"sensors": {"map": sens.mapping}})
                if "midi_forget" in msg:
                    midi_map.pop(str(msg["midi_forget"]), None)
                    midi.save_map(midi_map)
                    await broadcast({"midi": {"map": midi_map}})
                if "cams" in msg and kind == "stage" and isinstance(msg["cams"], list):   # the Mac's cameras, by name
                    live["cams"] = [str(c)[:200] for c in msg["cams"][:12]]
                    await broadcast({"cams": live["cams"]}, exclude=sock)
                if "moved" in msg and kind == "stage" and state["flowtrack"] != "off":   # movement: someone came or left
                    if state["motion"]:
                        await on_presence(bool(msg["moved"]))
                if "rule" in msg and kind == "stage" and state["flowtrack"] != "off":
                    for name in msg["rule"] if isinstance(msg["rule"], list) else [msg["rule"]]:
                        await on_rule(str(name)[:60])
                if "live" in msg and kind == "stage":  # the stage reports fps
                    lv = msg["live"]
                    live["fps"] = float(lv.get("fps", live["fps"]))
                    live["flow_rate"] = float(lv.get("flow_rate", 0) or 0)
                    await broadcast(status_msg())
        except (WebSocketDisconnect, RuntimeError, ValueError):
            pass
        finally:
            clients.pop(sock, None)
            roles.pop(sock, None)
            key_roles.pop(sock, None)
            eyes_pages.discard(sock)
            outbox.drop(sock)
            await feeds_end(sock)
            await broadcast(status_msg())

    def role_msg(sock) -> dict:
        """#148: what this client may do; a second Dream Control may take over from the first."""
        role = roles.get(sock)
        return {"role": role, "can_take": key_roles.get(sock) == "control" and role != "control"}

    async def take_control(sock):
        """#148: this Dream Control takes over; the one before goes on as a guest (and may take it back)."""
        for c, r in list(roles.items()):
            if r == "control" and c is not sock:
                roles[c] = "guest"
                await feeds_end(c)                     # #146: its camera and motion end with its rights
                outbox.post(c, json.dumps({**role_msg(c), "taken": True}))
        roles[sock] = "control"
        outbox.post(sock, json.dumps(role_msg(sock)))

    # ---------- #146: live camera and motion of the Dream Control device ----------
    def feeds_msg(sock=None) -> dict:
        """What the stage shows (who sends what) and, for one device, which feeds are its own."""
        msg = {"feeds": {k: ({"by": "Dream Control", **feed_info.get(k, {})} if c else None) for k, c in feeds.items()}}
        if sock is not None:
            msg["feeds_mine"] = [k for k, c in feeds.items() if c is sock]
        return msg

    async def feeds_changed():
        for c in list(clients):
            msg = feeds_msg(c)
            if roles.get(c) == "eyes":
                msg = {"feeds_mine": [k for k, o in feeds.items() if o is c]}
            outbox.post(c, json.dumps(msg))

    async def feed_set(sock, want: dict):
        """{"cam": true, "facing": "environment"} / {"cam": false} / {"motion": true|false}: only Dream Control or this
        Mac may send a live feed; a newer one takes over (the device before is told)."""
        if roles.get(sock) not in ("control", "local", "eyes"):
            return
        changed = False
        for kind in ("cam", "motion"):
            if kind not in want:
                continue
            if want[kind]:
                old = feeds[kind]
                feeds[kind] = sock
                by = "Dreamy Eyes" if roles.get(sock) == "eyes" else "Dream Control"
                feed_info[kind] = ({"by": by, "facing": "user" if want.get("facing") == "user" else "environment"}
                                   if kind == "cam" else {"by": by})
                if old is not None and old is not sock:
                    outbox.post(old, json.dumps({"feed_taken": kind}))
                if kind == "cam" and (state["mode"] != "cam" or state["cam_device"] != "device"):
                    await apply({"mode": "cam", "cam_device": "device"}, by="remote")
                changed = True
            elif feeds[kind] is sock:
                await feed_stop(kind)
                changed = True
        if changed:
            await feeds_changed()

    async def feed_stop(kind: str):
        feeds[kind] = None
        feed_info.pop(kind, None)
        if kind == "cam" and state["cam_device"] == "device":   # never falls back to the Mac's camera by itself
            await apply({"cam_device": "", **({"mode": "dream"} if state["mode"] == "cam" else {})}, by="remote")

    async def feed_end_other(sock, kind: str):
        """#156: Dream Control (or this Mac) ends a feed another device sends – e.g. the Dreamy Eyes' camera."""
        owner = feeds[kind]
        if owner is None or owner is sock:
            return
        await feed_stop(kind)
        outbox.post(owner, json.dumps({"feed_taken": kind}))
        await feeds_changed()

    async def feeds_end(sock):
        ended = [k for k, c in feeds.items() if c is sock]
        for kind in ended:
            await feed_stop(kind)
        if ended:
            await feeds_changed()

    MAX_FRAME = 1024 * 1024

    async def feed_frame(sock, data: bytes):
        """A JPEG of the device's camera, passed on to the stage(s) as it is; nothing is kept."""
        if feeds["cam"] is not sock or not data or len(data) > MAX_FRAME or data[:2] != b"\xff\xd8":
            return
        if roles.get(sock) == "eyes" or sock in eyes_pages:   # #166: the latest picture only, in memory, for a dream portrait
            eyes_seen["frame"], eyes_seen["frame_at"] = data, time.time()
        for c, kind in list(clients.items()):
            if kind == "stage" and not outbox.post_frame(c, data):   # #187: the latest picture only, never waited for
                clients.pop(c, None)

    MOTION_ADDR = {"acc": "/device/accelerometer", "lin": "/device/linear_acceleration",
                   "gyro": "/device/gyroscope", "ori": "/device/orientation"}

    def feed_motion(m: dict):
        """The device's motion sensors become sensor channels like OSC (#105): learning and strikes work the same."""
        for k, addr in MOTION_ADDR.items():
            v = m.get(k)
            if isinstance(v, list) and 0 < len(v) <= 4:
                sens.on_osc(addr, v, "Dream Control")

    # ---------- #160: faces painted by the AI for Dreamy Eyes (goddess, cat, Medusa) – only for the eyes ----------
    AIMASK_PROMPTS = {
        "goddess": "ethereal portrait of a beautiful goddess, face in front view, symmetrical, eyes looking at the viewer, "
                   "glowing skin, flowing hair, a diadem of light, dark background",
        "cat": "portrait of a mystical cat, face in front view, symmetrical, big eyes looking at the viewer, glowing fur, "
               "dark background",
        "medusa": "portrait of Medusa, face in front view, symmetrical, eyes looking at the viewer, hair of glowing snakes, "
                  "dark background",
        # more women of the dream (the owner's wish: at least ten more, all invented)
        "moon": "portrait of a moon priestess, silver hair, a crescent moon diadem, pale glowing skin, starlight",
        "dryad": "portrait of a forest dryad woman, leaves and moss woven in her hair, freckles of pollen, green light",
        "siren": "portrait of a sea siren woman, wet flowing hair with pearls and shells, seafoam, turquoise light",
        "flame": "portrait of a fire dancer woman, hair like flames, embers around her face, warm golden light",
        "frost": "portrait of an ice queen, frost crystals on her skin, a crown of icicles, pale blue light",
        "stars": "portrait of a star weaver woman, constellations glowing on her skin, cosmic dust in her hair",
        "blossom": "portrait of a flower fairy woman, petals in her hair, delicate butterfly wings behind her, soft pink light",
        "oracle": "portrait of a desert oracle woman, a golden veil with tiny coins, kohl-lined eyes, warm sand light",
        "clockwork": "portrait of a clockwork lady, fine brass filigree on her cheeks, tiny gears in her hair, candle light",
        "owl": "portrait of a forest shaman woman, a mask of owl feathers around her eyes, misty night",
        "masquerade": "portrait of a woman with an ornate masquerade mask of gold and lace, candle light, velvet darkness",
        "aurora": "portrait of an aurora spirit woman, hair flowing like northern lights, snow sparkling on her lashes",
        "raven": "portrait of a raven witch woman, black feathers in her hair, dark lips, silver eyes, moonlit fog",
        "nebula": "portrait of a cosmic woman made of a nebula, galaxies in her hair, glowing violet and teal",
        # about a third men (owner's wish): 7 of 24
        "sun": "portrait of a sun god, a man with a golden face, a crown of sun rays, warm glowing light",
        "greenman": "portrait of a green man, a male face made of leaves and vines, moss beard, forest spirit",
        "triton": "portrait of a sea king, a man with a coral crown, wet hair and beard, pearls, deep blue light",
        "sage": "portrait of an old star sage, a man with a long silver beard, constellations on his skin, deep blue robe",
        "faun": "portrait of a faun, a young man with small curled horns, ivy in his hair, mischievous smile",
        "pharaoh": "portrait of a dream pharaoh, a man with a golden mask-like face, lapis lazuli headdress, kohl-lined eyes",
        "knight": "portrait of a moon knight, a man with a noble bare face, no helmet, silver armor, a crescent moon circlet on his brow, pale glowing light",
    }
    AIMASK_STYLE = ", face in front view, symmetrical, eyes looking at the viewer, dreamlike, dark background"
    AIMASK_EVERY = float(os.environ.get("DREAM_AIMASK_EVERY", "50"))   # seconds between two faces
    aimasks: dict = {}          # kind -> (id, JPEG): only in memory, never in the gallery
    aimask_state = {"last": 0.0, "i": 0, "you_at": 0.0}
    # #166: the person in front of the eyes, painted into the dream – from the eyes' latest camera picture
    eyes_seen: dict = {"at": 0.0, "frame": None, "frame_at": 0.0}
    # #172: how often the trance (the third eye) may come at most – minutes, 0 = only by hand; kept for the next start
    EYES_CFG_FILE = os.path.join(STATE_DIR, "eyes.json")
    TRANCE_CHOICES = (0, 5, 12, 25)
    eyes_cfg: dict = {"trance_every": 12}
    with contextlib.suppress(Exception):
        _te = json.load(open(EYES_CFG_FILE)).get("trance_every")
        if _te in TRANCE_CHOICES:
            eyes_cfg["trance_every"] = _te

    async def eyes_send(msg: dict, also_control: bool = False) -> None:
        """A word to every Dreamy Eyes page (and, if asked, to Dream Control and this Mac)."""
        for c, r in list(roles.items()):
            if r == "eyes" or c in eyes_pages or (also_control and r in ("control", "local")):
                outbox.post(c, json.dumps(msg))
    FIRE_HOLD = 12                                     # #162: seconds a fire seen by the eyes keeps their faces burning
    FIRE_STYLE = ", surrounded by flames, glowing embers in the air, firelight on her face"

    def eyes_note(msg: dict) -> None:
        """#166/#162: what the eyes see right now – someone in front of them (just come?), or fire."""
        now = time.time()
        if msg.get("seen") is True:
            eyes_seen["at"] = now
            if msg.get("arrived") is True:             # someone just came: their portrait soon
                eyes_seen["arrived"] = now
        if msg.get("fire") is True:
            eyes_seen["fire"] = now
    eyes_pages: set = set()     # #166: control sockets of Dreamy Eyes pages, whichever key they signed in with
    YOU_EVERY = float(os.environ.get("DREAM_YOU_EVERY", "180"))  # seconds between two dream portraits (not too often)
    YOU_KEEP = 120.0                                    # a portrait is dropped after two minutes at the latest
    YOU_PROMPT = ("dreamlike painted portrait of this person, face in front view, eyes looking at the viewer, "
                  "glowing, ethereal light")

    def aimask_msg() -> dict:
        return {"aimasks": {k: f"/eyes/mask/{v[0]}.jpg" for k, v in aimasks.items()}}

    async def aimask_loop():
        """While Dreamy Eyes look on and this Mac paints, a face now and then – one quick step, in the dream's mood."""
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(5)
            eyes = [c for c, r in roles.items() if r == "eyes" or c in eyes_pages] + list(windows)   # #166, #201: the windows too
            now = time.time()
            if "you" in aimasks and now - aimasks["you"][2] > YOU_KEEP:   # #166: a portrait never stays long
                aimasks.pop("you", None)
                for c in eyes:
                    outbox.post(c, json.dumps(aimask_msg()))
            if now - eyes_seen["frame_at"] > 10:
                eyes_seen["frame"] = None                 # the picture is not kept beyond a few seconds
            if (not eyes or state["backend"] != "local" or not state.get("running", True) or model_state.get("loading")):
                continue
            mood = str(state.get("prompt") or "")[:160]
            if (now - eyes_seen["at"] < 5 and eyes_seen["frame"] and now - eyes_seen["frame_at"] < 3
                    and (now - aimask_state["you_at"] > YOU_EVERY
                         or (now - eyes_seen.get("arrived", 0) < 10 and now - aimask_state["you_at"] > 120))):
                frame, eyes_seen["frame"] = eyes_seen["frame"], None
                aimask_state["you_at"] = aimask_state["last"] = now
                try:
                    img = Image.open(io.BytesIO(frame)).convert("RGB")
                    side = min(img.size)
                    img = img.crop(((img.width - side) // 2, (img.height - side) // 2, (img.width + side) // 2,
                                    (img.height + side) // 2)).resize((512, 512), Image.LANCZOS)
                    prompt = YOU_PROMPT + (f", in the mood of: {mood}" if mood else "")
                    key = model_state.get("active") or "sd-turbo"
                    pic = await loop.run_in_executor(None, lambda: _render(key, img, prompt, 0.45, 3, secrets.randbelow(2**31)))
                except Exception as e:
                    print("dreamy eyes portrait:", e, flush=True)
                    continue
                aimasks["you"] = (secrets.token_hex(6), _jpeg(pic), time.time())
                print(f"dreamy eyes: a dream portrait in {time.time() - now:.2f} s", flush=True)
                for c in eyes:
                    outbox.post(c, json.dumps(aimask_msg()))
                continue
            fire = now - eyes_seen.get("fire", 0) < FIRE_HOLD   # #162: the eyes see fire – their faces burn too
            flame_due = fire and now - aimasks.get("flame", (None, None, 0))[2] > 60
            if now - aimask_state["last"] < (min(5, AIMASK_EVERY) if flame_due else AIMASK_EVERY):
                continue
            if not aimask_state.get("order"):         # every face once per round, in a new order each round
                aimask_state["order"] = random.sample(list(AIMASK_PROMPTS), len(AIMASK_PROMPTS))
            if flame_due:
                kind = "flame"                         # the fire spirit first, freshly painted
                with contextlib.suppress(ValueError):
                    aimask_state["order"].remove("flame")
            else:
                kind = aimask_state["order"].pop()
            base = AIMASK_PROMPTS[kind]
            prompt = (base + ("" if "front view" in base else AIMASK_STYLE) + (FIRE_STYLE if fire else "")
                      + (f", in the mood of: {mood}" if mood else ""))
            aimask_state["last"] = time.time()
            try:
                pic = await loop.run_in_executor(None, lambda: make_picture(
                    model_state.get("active") or "sd-turbo", prompt, 512, 512, secrets.randbelow(2**31), refine=False, steps=1))
            except Exception as e:                     # never disturb the show for a mask
                print("dreamy eyes mask:", e, flush=True)
                continue
            aimask_state["i"] += 1
            aimasks[kind] = (secrets.token_hex(6), _jpeg(pic), time.time())
            print(f"dreamy eyes: a {kind} face in {time.time() - aimask_state['last']:.2f} s", flush=True)
            for c in eyes:
                outbox.post(c, json.dumps(aimask_msg()))

    @app.get("/eyes/mask/{name}")
    def eyes_mask(request: Request, name: str):
        if request.state.role not in ("eyes", "control", "local", "window"):   # #201: the windows show the faces too
            return Response(status_code=403)
        for mid, data, _ in aimasks.values():
            if name == f"{mid}.jpg":
                return Response(data, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})
        return Response(status_code=404)

    async def renew_guest():
        """#148: a new guests' key: everyone in with the old one is out and needs the new QR code."""
        keys["guest"] = _key(TOKEN_FILE, renew=True)
        for c, r in list(key_roles.items()):
            if r == "guest":
                key_roles.pop(c, None)
                with contextlib.suppress(Exception):
                    await c.close(code=4403)
        await broadcast({"guest_renewed": True})

    # ---------- playlists ----------
    async def next_scene(force=False):
        lists = load_playlists()
        name = state["playlist"]
        if name == playlists.SURPRISE:
            scenes, journey, fade = [], False, playlists.DEFAULT_FADE
        else:
            scenes, journey, fade = playlists.playlist(lists.get(name))
            if not scenes:
                return
        wait = live.get("scene_secs") or max(5, int(state["interval"]))
        if not force and time.time() - live["scene_at"] < wait:
            return
        if name == playlists.SURPRISE:              # a random scene from any playlist, with random style additions
            sc = playlists.surprise(lists)
            if not sc:
                return
            live["index"], count = live["index"] + 1, 0
        else:
            if state["shuffle"] and not journey and len(scenes) > 1:
                choices = [i for i in range(len(scenes)) if i != live["index"]]
                live["index"] = choices[secrets.randbelow(len(choices))]
            else:
                live["index"] = (live["index"] + 1) % len(scenes)
            sc, count = scenes[live["index"]], len(scenes)
        live["scene_at"], live["scene_secs"] = time.time(), sc["secs"]
        before = state["prompt"]
        # the scene's own settings come along (they stay until something else changes them)
        await apply({"prompt": sc["prompt"], **{k: v for k, v in sc["settings"].items() if k in DEFAULT_STATE}})
        await broadcast({"scene": {"playlist": name, "index": live["index"], "count": count, "journey": journey,
                                   "pattern": sc["pattern"], "from": before, "fade": fade}})

    async def on_presence(present: bool):
        """Movement (#85): nobody there – the dream calms down; someone comes – a light impulse."""
        await broadcast({"cmd": "wake" if present else "calm"})

    # ---------- MIDI controller: faders, knobs and buttons (mappings in ~/.config/dream/midi.json) ----------
    midi_map = midi.load_map()
    midi_learn: dict = {}
    midi_ports: list = []
    midi_thr, midi_guess = midi.Throttle(), midi.RelativeGuess()

    def _midi_ports(names):
        midi_ports[:] = names

    midi_listener = midi.Listener(
        lambda key, msg: midi.handle(midi_map, midi_thr, midi_guess, midi_learn, state, key, msg), _midi_ports)
    midi_listener.start()

    async def midi_loop():
        """~30 times a second: glide towards the controller values (no jumps), fire button actions, report learning."""
        goal: dict = {}
        saved_at, dirty, ports_seen, last_key = 0.0, False, None, ""
        while True:
            await asyncio.sleep(1 / 30)
            pending, actions, learned = midi_thr.take()
            goal.update(pending)
            step = {}
            for k, g in list(goal.items()):
                cur = float(state.get(k, g))
                nxt = g if abs(g - cur) < 0.002 * (midi.TARGETS[k][1] - midi.TARGETS[k][0]) else cur + (g - cur) * 0.5
                step[k] = round(nxt, 4)
                if nxt == g:
                    goal.pop(k)
            if step:
                await apply(step, persist=False, by="midi")
                dirty = True
            for a in actions:
                if a == "pause":
                    await apply({"running": not state["running"]})
                elif a == "next":
                    await next_scene(force=True)
                elif a == "blackout":
                    live["master_before"] = state["master"] if state["master"] > 0.05 else live.get("master_before", 1.0)
                    await apply({"master": 0.0 if state["master"] > 0.05 else live["master_before"]})
                elif a == "reseed":
                    await apply({"seed": secrets.randbelow(99999) + 1})
                elif a == "restart":
                    await broadcast({"cmd": "restart"})
                elif a == "tap":                           # tap tempo: the stage times it
                    await broadcast({"cmd": "tap"}, only="stage")
                elif a == "pattern":                       # next music pattern: auto → Pulse → … → Flow → auto
                    order = ["auto", *playlists.PATTERNS]
                    cur = state.get("music_pattern", "auto")
                    await apply({"music_pattern": order[(order.index(cur) + 1) % len(order)] if cur in order else "auto"}, by="midi")
                elif a.startswith("fx_"):                  # effects: the stage knows which ones go together
                    await broadcast({"cmd": "fx", "arg": a[3:]}, only="stage")
            if learned:
                await broadcast({"midi": {"map": midi_map, "learned": learned}})
            key, at = midi_thr.last
            if ports_seen != midi_ports or (key and key != last_key and time.time() - at < 1):
                ports_seen, last_key = list(midi_ports), key
                await broadcast({"midi": {"ports": midi_ports, "last": key, "error": i18n.msg(midi_listener.error)}})
            if dirty and not goal and time.time() - saved_at > 1:   # save once the hands rest
                save_state()
                saved_at, dirty = time.time(), False

    # ---------- motion sensors on the body (phone app, wristband, glove) over OSC, port DREAM_SENSOR_PORT ----------
    SENSOR_PORT = int(os.environ.get("DREAM_SENSOR_PORT", "7020"))
    sens = sensors.Sensors()

    def sensor_setting(msg: dict):
        m = sens.mapping
        if msg.get("sensor_forget") in m:
            m.pop(msg["sensor_forget"])
        if isinstance(m.get(msg.get("sensor_invert")), dict):
            m[msg["sensor_invert"]]["invert"] = not m[msg["sensor_invert"]].get("invert")
        if "sensor_impulse" in msg:
            a = msg["sensor_impulse"]
            if a in sensors.IMPULSE_ACTIONS:
                m["impulse"] = {"action": a}
            else:
                m.pop("impulse", None)
        if "sensor_sens" in msg:
            try:
                sens.sensitivity = m["sensitivity"] = min(3.0, max(0.2, float(msg["sensor_sens"])))
            except (TypeError, ValueError):
                pass
        sensors.save_map(m)

    def _private(host: str) -> bool:
        try:
            ip = ipaddress.ip_address(host)
            return ip.is_private or ip.is_loopback
        except ValueError:
            return False

    async def sensor_loop():
        """Receives sensor OSC (any address with numbers); ~30 times a second hands mapped values to the
        controller glide (shared with MIDI) and turns whips into impulses."""
        from pythonosc.dispatcher import Dispatcher
        from pythonosc.osc_server import AsyncIOOSCUDPServer

        def on_any(client, address, *args):
            if _private(client[0]):                    # only devices at home (and this Mac)
                sens.on_osc(address, args, client[0])

        disp = Dispatcher()
        disp.set_default_handler(on_any, needs_reply_address=True)
        host = "0.0.0.0" if LAN else "127.0.0.1"       # a phone on the arm needs dream.sh --lan
        try:
            await AsyncIOOSCUDPServer((host, SENSOR_PORT), disp, asyncio.get_running_loop()).create_serve_endpoint()
            print(f"Sensors over OSC on {host}:{SENSOR_PORT}", flush=True)
        except OSError as e:
            print(f"Sensor port {SENSOR_PORT} not available: {e}", flush=True)
            return
        shown_at, sent = 0.0, {}
        while True:
            await asyncio.sleep(1 / 30)
            for target, value in sens.values(midi.TARGETS).items():
                lo, hi = midi.TARGETS[target]
                if abs(value - sent.get(target, 1e9)) > 0.003 * (hi - lo):   # only real changes
                    sent[target] = value
                    midi_thr.put(target, value)
            while sens.events:
                ev = sens.events.pop(0)
                if ev[0] == "impulse":
                    action = (sens.mapping.get("impulse") or {}).get("action")
                    if action in ("flash", "jolt"):
                        await broadcast({"cmd": action, "arg": ev[1]})
                    elif action:
                        midi_thr.act(action)
                    await broadcast({"sensors": {"impulse": ev[1]}}, only="stage")
                elif ev[0] == "learned":
                    await broadcast({"sensors": {"map": sens.mapping, "learned": {"key": ev[1], "target": ev[2]}}})
            if time.time() - shown_at > 0.5 and sens.ch:
                shown_at = time.time()
                await broadcast({"sensors": sens.live()})

    # ---------- movement (#85): the stage detects it and reports presence changes and rules ----------
    def load_rule_actions() -> dict:
        """Optional ~/.config/dream/motion.json: {"rules": {"<flowtrack rule name>": "next" | {"playlist": "Feuer"} | {"prompt": "…"}}}"""
        try:
            with open(os.path.join(paths.config_dir(), "motion.json")) as f:
                return json.load(f).get("rules", {})
        except (FileNotFoundError, ValueError):
            return {}

    async def on_rule(name: str):
        await broadcast({"rule": name})
        action = load_rule_actions().get(name)
        if action == "next":
            await next_scene(force=True)
        elif isinstance(action, dict):
            await apply({k: v for k, v in action.items() if k in ("playlist", "prompt", "mode", "strength")})

    # ---------- Syphon: the stage sends every shown frame, Dream publishes it smoothly for Resolume ----------
    # The AI makes only a few frames per second; the publisher crossfades between the last two at 30 fps.
    import numpy as np
    syph = {"prev": None, "cur": None, "t_prev": 0.0, "t_cur": 0.0, "thread": None, "lock": threading.Lock(), "error": ""}

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
        while state["syphon"]:
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
        while state["syphon"]:
            NSRunLoop.mainRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.002))
            await asyncio.sleep(0.1)
        syph["pump"] = None

    def syphon_sync():
        if state["syphon"] and syph["thread"] is None:
            syph["thread"] = threading.Thread(target=syphon_worker, daemon=True)
            syph["thread"].start()
        if state["syphon"] and not syph.get("pump"):
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
        return _jpeg(img, 80)

    async def preview_send(data: bytes):
        try:
            small = None
            if any(size == "small" for size in previews.values()):
                small = await asyncio.get_running_loop().run_in_executor(None, small_frame, data)
            for v, size in list(previews.items()):
                if not outbox.post_frame(v, data if size == "full" else small or data):
                    previews.pop(v, None)
        except Exception as e:                         # not a picture: no preview of it
            print("preview:", repr(e)[:200], flush=True)
        finally:
            preview["busy"] = False

    @app.websocket("/out")
    async def out(sock: WebSocket):
        """The stage sends every frame it shows (JPEG) for Syphon and the output windows; only from this Mac."""
        if not is_local(sock.client.host if sock.client else None) or not origin_ok(sock.headers):   # #175
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
                    for v in list(viewers):
                        outbox.post(v, text)
                    continue
                data = msg.get("bytes")
                if not data:
                    continue
                shown["frame"] = data
                now = time.time()
                if previews and not preview["busy"] and now - preview["at"] >= PREVIEW_EVERY:   # #141: 4 pictures a second
                    preview.update(at=now, busy=True)
                    preview["task"] = asyncio.create_task(preview_send(data))
                for v in list(viewers):                # #187: queued, the latest picture only – no window holds up another
                    if not outbox.post_frame(v, data):
                        viewers.discard(v)
                if state["syphon"]:
                    img = np.asarray(Image.open(io.BytesIO(data)).convert("RGBA"), dtype=np.float32)
                    if state["master"] < 1:
                        img[..., :3] *= state["master"]
                    with syph["lock"]:
                        syph["prev"], syph["t_prev"] = syph["cur"], syph["t_cur"]
                        syph["cur"], syph["t_cur"] = img, time.time()
                    syphon_sync()
        except (WebSocketDisconnect, RuntimeError):
            pass

    @app.get("/output")
    def output_page():
        return FileResponse(os.path.join(HERE, "static", "output.html"))

    # ---------- #201: dream windows – any number of old phones and tablets as windows to the dream ----------
    # One organism over all of them: no window has a motif. Dream only sows seeds – which living thing, where it comes
    # in and goes out, a random number – and every window draws it itself (static/window.html, static/dreamlife.js).
    # Wanderers go from window to window: when one leaves a window, it comes into the next one from the other side.
    # They all hear the stage's pulse (the /view stream), now and then a wave runs over them in the order they came,
    # and they feel with Dreamy Eyes (trance, blushing).
    WANDER_KINDS = ("cloud", "cloud", "moth", "eye", "symbol", "bubbles", "aurora", "picture", "orbit")
    LOCAL_KINDS = ("mandala", "bloom", "tree", "kaleido", "eyes", "symbol", "picture", "cloud", "face")
    SYMBOLS = ("spiral", "flower", "star", "moon", "third", "sun")
    EDGES = ("left", "right", "top", "bottom")
    OPPOSITE = {"left": "right", "right": "left", "top": "bottom", "bottom": "top"}
    WINDOW_MOODS = ("trance", "blush")
    windows: dict = {}                                 # socket -> {"next": when it gets its next seed}; in the order they came
    wanderers: list = []                               # [when, seed, hops left, index of the window it leaves]
    seed_no = [0]
    mood_at: dict = {}

    def window_seed(kind: str, wander: bool, enter: str = "in") -> dict:
        seed_no[0] += 1
        if kind == "face" and not aimasks:             # no face painted yet: something else
            kind = "mandala"
        exit_ = random.choice([e for e in EDGES if e != enter]) if wander else "in"
        return {"id": seed_no[0], "kind": kind, "variant": random.choice(SYMBOLS) if kind == "symbol" else "",
                "seed": random.randrange(1 << 30), "life": round(random.uniform(7, 12) if wander else random.uniform(9, 16), 2),
                "enter": enter, "exit": exit_, "hue": round(random.uniform(-70, 70)), "size": round(random.uniform(0.7, 1.3), 2)}

    async def window_send(sock, msg: dict):
        outbox.post(sock, json.dumps(msg))

    def window_add(sock):
        windows[sock] = {"next": time.time() + random.uniform(0.3, 1.5)}

    async def window_tell_all():
        for i, c in enumerate(list(windows)):
            await window_send(c, {"window": {"index": i, "of": len(windows)}})

    async def windows_mood(kind: str):
        """Dreamy Eyes go into trance or blush: all windows feel it – the blush runs through them in their order."""
        now = time.time()
        if now - mood_at.get(kind, 0) < 3 or not windows:
            return
        mood_at[kind] = now
        for i, c in enumerate(list(windows)):
            await window_send(c, {"mood": {"kind": kind, "index": i, "of": len(windows)}})

    async def windows_tick(now: float):
        order = list(windows)
        for c in order:
            w = windows[c]
            if now > w["next"]:                        # a new seed for this window: something blooming here or a wanderer
                w["next"] = now + random.uniform(2.0, 4.5)
                wander = random.random() < 0.45
                seed = window_seed(random.choice(WANDER_KINDS if wander else LOCAL_KINDS), wander,
                                   random.choice(EDGES) if wander else "in")
                await window_send(c, {"life": seed})
                if wander:
                    wanderers.append([now + seed["life"], seed, random.randint(1, 3), order.index(c)])
        for wd in list(wanderers):                     # wanderers leave one window and come into the next one
            if now < wd[0]:
                continue
            wanderers.remove(wd)
            if not order:
                continue
            last, hops = wd[1], wd[2]
            target = order[(wd[3] + 1) % len(order)]
            seed = window_seed(last["kind"], True, OPPOSITE[last["exit"]])
            seed.update(variant=last["variant"], seed=last["seed"], hue=last["hue"], size=last["size"])   # the same being
            await window_send(target, {"life": seed})
            if hops > 1:
                wanderers.append([now + seed["life"], seed, hops - 1, order.index(target)])

    async def windows_loop():
        next_wave = time.time() + random.uniform(40, 90)
        while True:
            await asyncio.sleep(0.5)
            if not windows:
                wanderers.clear()
                continue
            now = time.time()
            await windows_tick(now)
            if now > next_wave and len(windows) > 1:   # a wave over all of them, in the order they came
                next_wave = now + random.uniform(60, 150)
                for i, c in enumerate(list(windows)):
                    await window_send(c, {"wave": {"index": i, "of": len(windows)}})

    app.router.on_startup.append(lambda: live.setdefault("windows", asyncio.get_event_loop().create_task(windows_loop())))

    @app.websocket("/view")
    async def view(sock: WebSocket):
        """An output window (beamer, second monitor): gets every picture the stage shows, renders nothing itself."""
        if not ws_allowed(sock):
            await sock.close(code=4403)
            return
        await sock.accept()
        key_roles[sock] = ws_role(sock)
        outbox.box(sock)
        small = sock.query_params.get("preview") == "1"   # #141: the remote's small live preview
        if small:
            previews[sock] = "small"
        else:
            viewers.add(sock)
        if sock.query_params.get("as") == "window":    # #201: a dream window – it gets seeds of the organism
            window_add(sock)
        await broadcast(status_msg())                  # the stage starts sending its pictures
        try:
            outbox.post(sock, json.dumps({"master": state["master"]}))
            if sock in windows:
                outbox.post(sock, json.dumps(aimask_msg()))
                await window_tell_all()
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
                        if size in ("small", "full") and sock in previews and previews[sock] != size:
                            previews[sock] = size
                            if size == "full" and shown["frame"]:
                                outbox.post_frame(sock, shown["frame"])
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            viewers.discard(sock)
            previews.pop(sock, None)
            key_roles.pop(sock, None)
            outbox.drop(sock)
            if windows.pop(sock, None) is not None:
                await window_tell_all()
            await broadcast(status_msg())

    async def scene_loop():
        while True:
            await asyncio.sleep(1)
            try:
                if state["playlist"]:
                    await next_scene()
            except Exception as e:                    # never let the installation loop die
                print("scene loop:", e, flush=True)

    # ---------- remote page, QR code, uploads ----------
    # ---------- playlists: read, edit, delete, generate (the owner's file ~/.config/dream/playlists.json) ----------
    @app.get("/playlists/{name}")
    def playlist_get(name: str):
        lists = load_playlists()
        if name not in lists:
            return JSONResponse({"error": "unknown"}, status_code=404)
        builtin = name in playlists.read_file(os.path.join(HERE, "playlists.json"))
        return {"name": name, "text": playlists.to_text(lists[name]), "builtin": builtin,
                "own": name in playlists.read_file(playlists.USER_FILE), "temp": name in temp_lists}

    @app.post("/playlists")
    async def playlist_save(data: dict = Body(...)):
        name = playlists.clean_name(data.get("name", ""))
        entry = playlists.from_text(data.get("text", ""))
        scenes = entry["scenes"] if isinstance(entry, dict) else entry
        if not name or not scenes:
            return JSONResponse({"error": "empty"}, status_code=422)
        playlists.save_user(name, entry)               # saving keeps it: also a temporary AI playlist becomes own
        temp_lists.pop(name, None)
        await broadcast({"playlists": playlist_names()})
        return {"name": name, "count": len(scenes)}

    @app.delete("/playlists/{name}")
    async def playlist_delete(name: str):
        """Removes the owner's own version; a shipped playlist of the same name comes back."""
        if name in temp_lists:
            temp_lists.pop(name)
        else:
            playlists.save_user(name, None)
        if state["playlist"] == name and name not in load_playlists():
            await apply({"playlist": ""})
        await broadcast({"playlists": playlist_names()})
        return {"deleted": name}

    @app.post("/playlists/generate")
    async def playlist_generate(data: dict = Body(...)):
        topic = re.sub(r"\s+", " ", str(data.get("topic", ""))).strip()[:120]
        if not topic:
            return JSONResponse({"error": "empty"}, status_code=422)
        try:
            prompts = await asyncio.get_running_loop().run_in_executor(
                None, playlists.generate, topic, OLLAMA, PROMPT_MODEL)
        except (OSError, ValueError):                  # Ollama not running, model missing or a broken answer
            return JSONResponse({"error": "ollama"}, status_code=503)
        if len(prompts) < 3:
            return JSONResponse({"error": "few"}, status_code=502)
        name = playlists.clean_name(playlists.AI_PREFIX + topic)
        playlists.keep_temp(temp_lists, name, prompts)  # temporary; "Keep"/"Save" makes it the owner's own
        await broadcast({"playlists": playlist_names()})
        return {"name": name, "prompts": prompts, "temp": True}

    @app.get("/remote")
    def remote_page():
        return FileResponse(os.path.join(HERE, "static", "remote.html"))

    @app.get("/window")
    def window_page():
        """#201: a dream window – an old phone or tablet that shows an aspect of the dream."""
        return FileResponse(os.path.join(HERE, "static", "window.html"), headers={"Cache-Control": "no-cache"})

    @app.get("/eyes")
    def eyes_page():
        """#156: Dreamy Eyes – a phone that lends its front camera and looks back with dreaming eyes."""
        return FileResponse(os.path.join(HERE, "static", "eyes.html"), headers={"Cache-Control": "no-cache"})

    @app.get("/control")
    def control_page():
        """#145: the same remote as an installable app of its own ("Dream Control", own manifest and start address)."""
        page = open(os.path.join(HERE, "static", "remote.html"), encoding="utf-8").read()
        page = page.replace("/static/remote.webmanifest", "/static/control.webmanifest", 1)
        page = page.replace("<title>Dream · Remote</title>", "<title>Dream Control</title>", 1)
        return Response(page, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})

    @app.get("/dream-ca.crt")
    def ca_cert():
        """#145: Dream's own certificate authority, to install once on each of the owner's devices."""
        import tls
        path = tls.paths(TLS_DIR)["ca"]
        if not LAN or not os.path.exists(path):
            return Response(status_code=404)
        return FileResponse(path, media_type="application/x-x509-ca-cert", filename="dream-ca.crt")

    @app.get("/remote-info")
    def remote_info(request: Request):
        if request.state.role == "control":            # #156: Dream Control sets up the Dreamy Eyes phone
            return {"lan": LAN, "eyes": eyes_url() if LAN else None, "window": window_url() if LAN else None,
                    "https": tls_state["on"], "source": SOURCE_URL}
        if not is_local(request.client.host if request.client else None):
            return {"lan": LAN, "source": SOURCE_URL}   # #178: everybody may see where the code is
        return {"lan": LAN, "source": SOURCE_URL, "url": remote_url() if LAN else None, "output": output_url() if LAN else None,
                "control": control_url() if LAN else None, "window": window_url() if LAN else None, "https": tls_state["on"],
                "https_error": tls_state["error"], "ca": ca_url() if LAN and tls_state["on"] else None}

    @app.get("/qr.svg")
    def qr_svg(request: Request):
        what = request.query_params.get("for")
        if not LAN or not (is_local(request.client.host if request.client else None)
                           or (request.state.role == "control" and what in ("eyes", "window"))):   # #156, #201
            return Response(status_code=404)
        import qrcode
        import qrcode.image.svg
        url = {"output": output_url, "control": control_url, "ca": ca_url, "eyes": eyes_url, "window": window_url}.get(what, remote_url)()
        img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathFillImage, box_size=12, border=2)
        buf = io.BytesIO()
        img.save(buf)
        return Response(buf.getvalue(), media_type="image/svg+xml")

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
        await broadcast({"cmd": "media", "arg": {"kind": kind, "url": f"/media/{name}"}})
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
        await broadcast({"gallery": gallery_list()})

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
        await broadcast({"cmd": "media", "arg": {"kind": "img" if g["kind"] == "img" else "vid", "url": g["url"]}})
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
        await broadcast({"gallery": gallery_list()})
        # what was the input right now goes: the stage dreams on from its current picture
        await broadcast({"cmd": "gallery_removed", "arg": {"urls": [g["url"] for _, g in items]}})
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
        await broadcast({"gallery": gallery_list()})
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
            await broadcast({"gallery": gallery_list()})
        return {"saved": g["saved"]}

    # ---------- style reference pictures (#123): kept by their content's id, so scenes can name them ----------
    REF_DIR = os.path.join(STATE_DIR, "refs")
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
