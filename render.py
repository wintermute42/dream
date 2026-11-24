"""The painter: the image models (SD-Turbo, SDXL-Turbo, their ControlNets), one image-to-image step per picture, the
pictures and clips on request, and switching models without a gap. Used by both roles – the app on the Mac (MPS) and
the worker on the cloud GPU (CUDA). With styles.py the only part of Dream that loads PyTorch; what it paints with is
named in models.py."""
import contextlib
import gc
import io
import os
import re
import sys
import threading
import time

import numpy as np
import torch
from PIL import Image

import config
import models
import styles

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
    xl = models.MODELS[key][2]
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
            repo, vae, _ = models.MODELS[key]
            print(f"Loading {repo} on {device} …", flush=True)
            # #129: read from disk beside the model that paints, but onto the GPU only between two pictures
            p = AutoPipelineForImage2Image.from_pretrained(repo, torch_dtype=dtype,
                                                           variant="fp16" if dtype == torch.float16 else None)
            p.vae = AutoencoderTiny.from_pretrained(vae, torch_dtype=dtype)
            if model_state["loading"] == key:
                model_state["first"] = False          # #238: downloaded – from here on it is loading, not downloading
            with gpu_lock:
                p = p.to(device)
            p.set_progress_bar_config(disable=True)
            _pipes[key] = p
            if models.MODELS[key][2] and device == "cuda" and os.environ.get("DREAM_WITH_REF") == "1":
                try:                                  # #131: a reference picture was in use – compile with its adapter
                    styles.ip_download()
                    styles.ip_ready(p)
                except Exception as e:                # the reference picture is a bonus: SDXL runs without it
                    print(f"style reference adapter not loaded: {e!r}", flush=True)
            if models.MODELS[key][2] and device == "cuda":
                try:
                    styles.prime(p)                   # #131: before compiling, so a style switch needs no new compile
                except Exception as e:
                    print(f"style models not primed: {e!r}", flush=True)
            if model_state["active"] in (None, key):  # #238: never beside a model that paints (it then runs uncompiled)
                _speed_up(key, p)
            _render(key, Image.new("RGB", (512, 512), (40, 20, 60)), "psychedelic colors", 0.5, 2, 1)  # warm up
            print(f"{key} ready.", flush=True)
    return _pipes[key]


COMPILE_CACHE = os.environ.get("DREAM_COMPILE_CACHE", os.path.join(config.HERE, "compile-cache"))
# #238: a model is compiled only before its first picture, while nothing paints – never on stage. Compiling beside a
# model that paints is not usable in one process (cloud test 2026-11-17: 0.2–0.4 pictures/s, because the compiler holds
# Python's lock, and broken pictures, because its tracing patches every module call of the process), and compiling
# inside a picture holds the stage for minutes. So after the compile PyTorch only runs what is compiled
# ("eager_on_recompile"): a picture the model was not compiled for (another size or format, pose or outlines, the
# reference picture's adapter) is painted uncompiled at once – the same look, somewhat slower, no pause.
compile_state = {"since": None, "cached": False, "shapes": None}   # the compile under way: since when, from the cache,
#                                                       and the kinds of pictures (_shape) painted during it
_compiled: dict = {}                                  # model -> the kinds of pictures it was compiled for
_plain = {"key": None}                                # the model whose last picture was painted uncompiled, compiling being on
_run_only = {"on": False}                             # PyTorch runs compiled code and compiles nothing new
RECOMPILE_AFTER = 3.0
# The pictures a model is compiled for at the start: the usual sizes, square and 16:9 (the stage widens a size to the
# next multiple of 64: static/index.html, dims()). Every one makes the start longer, so only these.
START_SIZES = (512, 384)
START_SHAPES = tuple((w, h) for wide in (False, True) for h in START_SIZES
                     for w in [round(h * 16 / 9 / 64) * 64 if wide else h])


def _compile_wanted() -> bool:
    return device == "cuda" and os.environ.get("DREAM_COMPILE", "1") != "0"


def _stance(run_only: bool) -> None:
    """Whether PyTorch may compile (before a model's first picture) or only runs what is compiled (on stage)."""
    try:
        torch.compiler.set_stance("eager_on_recompile" if run_only else "default")
        _run_only["on"] = run_only
    except Exception as e:                            # a PyTorch without stances: as before #238, see compiling()
        _run_only["on"] = False
        print(f"compile stance not set ({str(e).splitlines()[0][:120]})", flush=True)


def _shape(img, control: bool, ref: bool) -> tuple:
    """What a compiled model is compiled for: the picture's size, pose/outlines on top, the reference adapter."""
    return (*img.size, bool(control), bool(ref))


def _note_shape(key, img, control, ref) -> None:
    """Notes what kind of picture is painted now: during the compile what the model is compiled for, afterwards
    whether this one is painted uncompiled. Only where models are compiled (the cloud GPU)."""
    if compile_state["shapes"] is not None:           # the compile's own pictures
        compile_state["shapes"].add(_shape(img, control, ref))
    elif _compile_wanted():
        _plain["key"] = key if _shape(img, control, ref) not in _compiled.get(key, ()) else None


def compiling(now: float | None = None) -> float | None:
    """Since when (time.time()) a model is being compiled, or None: nothing compiles. Without stances (an older
    PyTorch) a compiled model compiles again by itself, inside a picture, when something it was not compiled for
    arrives: a picture of a compiled model that has been in work for RECOMPILE_AFTER seconds is that."""
    if compile_state["since"]:
        return compile_state["since"]
    key, since = _busy["key"], _busy["since"]
    now = time.time() if now is None else now
    stuck = not _run_only["on"] and key in _compiled and since and now - since > RECOMPILE_AFTER
    return since if stuck else None


def _cache_file(key, p):
    """#131: the compiled code depends on GPU, PyTorch, model and adapter – one cache file for each such combination."""
    gpu = re.sub(r"[^A-Za-z0-9]+", "-", torch.cuda.get_device_name(0)).strip("-")
    ref = "-ref" if getattr(p, "_dream_ip", False) else ""
    shapes = f"-{len(START_SHAPES)}shapes"               # a cache of fewer shapes would never be completed (it is saved once)
    return os.path.join(COMPILE_CACHE, f"{gpu}-torch{torch.__version__.split('+')[0]}-{key}{ref}{shapes}.bin")


def _speed_up(key, p):
    """#100/#131: on an NVIDIA GPU (the cloud) the model is compiled before its first picture: torch.compile of the
    UNet and the tiny decoder, channels-last memory and TF32, one variant (the reference adapter only if it was in
    use). The compiled code is kept as a cache file that dream-cloud brings to the Mac and back to the next GPU of the
    same type: the first start on a GPU type compiles for some minutes, later ones about one. #238: afterwards nothing
    compiles any more (see above) – what was not compiled here is painted uncompiled.
    If compiling fails, the model simply runs as before. DREAM_COMPILE=0 switches it off."""
    if not _compile_wanted():
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
    compile_state.update(since=t0, cached=cache_hit, shapes=set())   # #238: /health and /stats say that it compiles
    _stance(run_only=False)
    try:
        p.unet.to(memory_format=torch.channels_last)
        p.unet = torch.compile(p.unet, fullgraph=False)
        p.vae.decoder = torch.compile(p.vae.decoder, fullgraph=False)
        look = {"ref": ""} if getattr(p, "_dream_ip", False) else None   # with the adapter: its one variant
        for shape in START_SHAPES:                       # the usual pictures, compiled now – nothing is compiled on stage
            _render(key, Image.new("RGB", shape, (40, 20, 60)), "psychedelic colors", 0.5, 2, 1, look=look)
        _compiled[key] = compile_state["shapes"]
        print(f"{key}: compiled for the GPU in {time.time() - t0:.0f} s", flush=True)
    except Exception as e:                               # compiling is a bonus: without it Dream still works
        p.unet, p.vae.decoder = eager
        print(f"{key}: compiling failed, running uncompiled ({str(e).splitlines()[0][:160]})", flush=True)
        return
    finally:
        compile_state.update(since=None, cached=False, shapes=None)
        _stance(run_only=True)                           # from here on: compiled code is run, nothing new is compiled
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
                    print(f"Loading ControlNet {models.CONTROLNETS[k][key]} …", flush=True)
                    with _load_lock:                    # only a ControlNet used for the first time waits for a load
                        cn = ControlNetModel.from_pretrained(models.CONTROLNETS[k][key], torch_dtype=dtype)
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


# time spent rendering and pictures made (for the load display); #238: the picture in work – its model, since when
_busy = {"t": 0.0, "n": 0, "key": None, "since": None}

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
    _busy.update(key=key, since=t0)
    try:
        return _render_now(key, img, prompt, strength, steps, seed, pose, pose_scale, seed2, st, prompt2, pt, edges, look)
    finally:
        _busy.update(key=None, since=None)
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
        if models.MODELS[key][2]:                                    # #123: style model and reference picture (SDXL only)
            look = look or {}
            styles.apply(p, look.get("style"), look.get("sa", 0))
            if look.get("ref") and not getattr(p, "_dream_ip", False):
                styles.ip_load_later(p)                       # first reference picture: the adapter comes in the background
                if getattr(p, "_dream_ip", False) and hasattr(p.unet, "_orig_mod"):
                    _compiled.pop(key, None)
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
            _note_shape(key, img, True, "ip_adapter_image_embeds" in args)
            if _perf["on"]:
                _perf_wrap(pp.controlnet, "forward", "controlnet")
            one = len(kinds) == 1
            with _blended_noise(pp, seed, seed2, st):
                out = pp(control_image=imgs[0] if one else imgs,
                         controlnet_conditioning_scale=scales[0] if one else scales, **args)
        else:
            _note_shape(key, img, False, "ip_adapter_image_embeds" in args)
            with _blended_noise(p, seed, seed2, st):
                out = p(**args)
    return out.images[0]


# ---------- switching models without a gap (#61) ----------
# The model in use keeps dreaming while the next one loads in the background; then the old one is freed.
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
        _compiled.pop(key, None)
        for d in (_cn_models, _ctl_pipes):
            for k in [k for k in d if k[0] == key]:
                d.pop(k, None)
        for k in [k for k in _embeds if k[0] == key]:
            _embeds.pop(k, None)
        if models.MODELS.get(key, (0, 0, False))[2]:
            styles.forget()
    _free_memory()
    print(f"{key} freed.", flush=True)


def _room_for(key) -> bool:
    """Is there room to load key while the current model stays? (unknown → yes, the OS will cope)"""
    try:
        import psutil
        return psutil.virtual_memory().available / 1e9 > models.NEED_GB.get(key, 9.0) + 2.0
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


def downloaded_gb(repo: str, cache: str | None = None) -> float | None:
    """#238: how much of a model has arrived in the download cache (finished and unfinished files); None: not known."""
    try:
        if cache is None:
            from huggingface_hub.constants import HF_HUB_CACHE as cache
        with os.scandir(os.path.join(cache, "models--" + repo.replace("/", "--"), "blobs")) as files:
            return round(sum(f.stat().st_size for f in files if f.is_file()) / 1e9, 2)
    except Exception:
        return None


def progress(now: float | None = None) -> dict:
    """#238: where the renderer stands, for /health and /stats – so a cloud GPU that loads or compiles says so itself
    instead of just sending no pictures. "ready": the next picture comes at once. "painting": a model is there and
    paints (while it is compiled before its first picture it does not); "unoptimized": it painted its last picture
    uncompiled, because it was not compiled for that kind of picture – slower, but without a pause."""
    now = time.time() if now is None else now
    loading, since = model_state["loading"], compiling(now)
    out = {"model": model_state["active"], "loading": loading, "model_error": model_state["error"],
           "first_download": bool(model_state["first"]), "compiling": since is not None}
    if since is not None:
        out.update(compiling_s=int(now - since), compile_cached=bool(compile_state["cached"]))
    if loading and model_state["first"]:
        got = downloaded_gb(models.MODELS[loading][0])
        if got is not None:
            out["download_gb"] = got
    paints = _ready(model_state["active"])            # the model in use paints on while another one loads
    out["failed"] = bool(model_state["error"]) and not _pipes and not loading   # nothing to paint with, nothing coming
    out["ready"] = since is None and (paints or not loading) and not out["failed"]
    out["painting"] = paints and since is None
    out["unoptimized"] = out["painting"] and _plain["key"] is not None and _plain["key"] == model_state["active"]
    return out


def preload(keys) -> None:
    """DREAM_PRELOAD (the cloud GPU): the models are loaded at the start – #238: beside the server, which answers
    meanwhile and tells how far the load is (downloading, loading, compiling)."""
    def run():
        for key in keys:
            model_state.update(loading=key, first=not _in_cache(models.MODELS[key][0]))
            try:
                pipeline(key)
            except Exception as e:
                print(f"loading {key} failed: {e!r}", flush=True)
                model_state.update(error=f"{type(e).__name__}: {e}"[:300], error_key=key, error_at=time.time())
                _pipes.pop(key, None)
            finally:
                model_state.update(loading=None, first=False)

    if keys:
        model_state["loading"] = keys[0]              # said before the server answers its first question
        threading.Thread(target=run, daemon=True, name="preload").start()


def _in_cache(repo: str) -> bool:
    """#179: whether a model is already downloaded (else its first load is a download of gigabytes)."""
    try:
        from huggingface_hub import try_to_load_from_cache
        return isinstance(try_to_load_from_cache(repo, "model_index.json"), str)
    except Exception:
        return True                                    # unknown: no download hint rather than a wrong one


def use_model(key) -> str:
    """The model to paint the next picture with: the wanted one once it is ready, the current one until then."""
    key = key if key in models.MODELS else "sd-turbo"
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
        if model_state["loading"] != key:             # #238: else the worker loads it already and has said so
            model_state["loading"], model_state["first"] = key, not _in_cache(models.MODELS[key][0])
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
            if not models.MODELS[key][2]:
                try:
                    from diffusers import AutoencoderKL
                    with _load_lock:
                        _full_vae[key] = AutoencoderKL.from_pretrained(
                            models.MODELS[key][0], subfolder="vae", torch_dtype=dtype, local_files_only=True,
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
    key = key if key in models.MODELS else "sd-turbo"
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
    key = key if key in models.MODELS else "sd-turbo"
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


preload([m for m in os.environ.get("DREAM_PRELOAD", "").split(",") if m in models.MODELS])


def gpu_memory_gb() -> float | None:
    """What the Apple GPU holds for Dream right now (for the load display); None where that cannot be asked."""
    try:
        if device == "mps":
            return round(torch.mps.driver_allocated_memory() / 1e9, 1)
    except Exception:
        pass
    return None


def free_after_error():
    """After "out of memory": give back what the GPU still holds, so the next (smaller) picture has room."""
    gc.collect()
    with contextlib.suppress(Exception):
        torch.mps.empty_cache() if device == "mps" else torch.cuda.empty_cache()
