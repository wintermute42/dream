"""Real picture styles for SDXL-Turbo (#123): style models (LoRAs) and a style reference picture (IP-Adapter).

Neither touches the prompt. A style model is fused into the model's weights (no extra work per picture, and a
compiled model stays compiled): the LoRA is loaded once to read its low-rank factors, then removed again, and the
weights become original + amount × change. The originals of the touched weights wait on the CPU, so another style
or amount always starts from the exact original. The reference picture works through the IP-Adapter in "style
only" mode (InstantStyle: only the block that carries colour, stroke and texture listens to it), with its strength
blended between "no picture" and the picture.

All functions run on the render thread while it holds the GPU lock; downloads run in the background.
"""
import threading
import time

import torch
import torch.nn.functional as F

# key → (Hugging Face repo, file, label). Only freely licensed models (Apache 2.0, MIT, CreativeML OpenRAIL-M),
# picked because they show without their trigger words (Dream never adds words to the prompt). Tried on SDXL-Turbo
# 2026-11-17: line art and colouring-book models stayed invisible without their words and were left out.
LORAS = {
    "watercolour": ("ostris/watercolor_style_lora_sdxl", "watercolor_v1_sdxl.safetensors", "Watercolour"),
    "crayon": ("ostris/crayon_style_lora_sdxl", "crayons_v1_sdxl.safetensors", "Crayon"),
    "pixel": ("nerijs/pixel-art-xl", "pixel-art-xl.safetensors", "Pixel art"),
    "papercut": ("TheLastBen/Papercut_SDXL", "papercut.safetensors", "Paper cut"),
    "sticker": ("Norod78/SDXL-StickerSheet-Lora", "SDXL-StickerSheet-Lora.safetensors", "Sticker"),
    "illustration": ("goofyai/Leonardo_Ai_Style_Illustration", "leonardo_illustration.safetensors", "Illustration"),
}
MAX_AMT = 2.0                  # beyond 1 the style is pushed harder than it was trained (pixel art needs about 2)
IP_ADAPTER = ("h94/IP-Adapter", "sdxl_models", "ip-adapter_sdxl_vit-h.safetensors", "models/image_encoder")  # Apache 2.0
STYLE_ONLY = {"up": {"block_0": [0.0, 1.0, 0.0]}}       # InstantStyle: the block that carries the look, not the content
NAME = "dreamstyle"

state = {"key": None, "amt": 0.0, "at": 0.0, "error": None, "loading": None}
_factors: dict = {}            # style key → [(weight, A, B, scale, fan_in_fan_out)]
_orig: dict = {}               # id(weight) → (weight, original on the CPU)
_paths: dict = {}              # style key → downloaded file
_refs: dict = {}               # reference hash → PIL picture (a few)
_ref_embeds: dict = {}         # (pipeline id, hash) → image embedding


def _unwrapped(p):
    """The model without torch.compile's wrapper (loading adapters changes modules); put back afterwards."""
    class Ctx:
        def __enter__(self):
            self.compiled = p.unet if hasattr(p.unet, "_orig_mod") else None
            if self.compiled is not None:
                p.unet = self.compiled._orig_mod

        def __exit__(self, *a):
            if self.compiled is not None:
                p.unet = self.compiled
    return Ctx()


def _download(key):
    def run():
        try:
            from huggingface_hub import hf_hub_download
            repo, file, _ = LORAS[key]
            _paths[key] = hf_hub_download(repo, file)
        except Exception as e:                       # no network, gone from the hub: say so, keep dreaming
            state["error"] = ("Style {s} could not be loaded: {e}", {"s": LORAS[key][2], "e": type(e).__name__})
            print(f"style {key}: download failed: {e!r}", flush=True)
        finally:
            state["loading"] = None
    state["loading"] = key
    threading.Thread(target=run, daemon=True, name=f"style-{key}").start()


def _read_factors(p, key):
    """Loads the LoRA into the model only to copy its factors, then removes it again (the model is unchanged)."""
    out = []
    with _unwrapped(p):
        p.load_lora_weights(_paths[key], adapter_name=NAME)
        try:
            for comp in (p.unet, getattr(p, "text_encoder", None), getattr(p, "text_encoder_2", None)):
                for m in comp.modules() if comp is not None else ():
                    if NAME not in getattr(m, "lora_A", {}):
                        continue
                    if getattr(m, "use_dora", {}).get(NAME):
                        raise ValueError("DoRA style models are not supported")
                    out.append((m.get_base_layer().weight, m.lora_A[NAME].weight.detach().clone(),
                                m.lora_B[NAME].weight.detach().clone(), float(m.scaling[NAME]),
                                bool(getattr(m, "fan_in_fan_out", False))))
        finally:
            p.unload_lora_weights()
    return out


def _delta(A, B, s, fifo):
    A, B = A.float(), B.float()
    if A.dim() == 2:
        d = B @ A
    elif A.shape[2:] == (1, 1):
        d = (B.flatten(1) @ A.flatten(1)).unsqueeze(2).unsqueeze(3)
    else:
        d = F.conv2d(A.permute(1, 0, 2, 3), B).permute(1, 0, 2, 3)
    return (d.T if fifo else d) * s


@torch.no_grad()
def _set_weights(key, amt):
    """Weights = original + amt × the style's change (amt 0 or no style: the original)."""
    for w, orig in _orig.values():                   # back to the original first (a style touches its own weights)
        w.copy_(orig.to(w.device))
    if key and amt > 0:
        for w, A, B, s, fifo in _factors[key]:
            if id(w) not in _orig:
                _orig[id(w)] = (w, w.detach().to("cpu", copy=True))
            w.copy_((w.float() + amt * _delta(A, B, s, fifo).to(w.device)).to(w.dtype))


def apply(p, key, amt):
    """Puts style `key` with strength amt into the model p (SDXL); a change of amount waits 0.3 s (slider drags)."""
    key = key if key in LORAS else None
    amt = max(0.0, min(MAX_AMT, float(amt or 0))) if key else 0.0
    if key == state["key"] and abs(amt - state["amt"]) < 0.01:
        return
    if key and key != state["key"] and key not in _factors:
        if key not in _paths:                        # first use: download in the background, dream on meanwhile
            if state["loading"] != key:
                _download(key)
            return
        try:
            t0 = time.time()
            _factors.clear()                         # only one style's factors are kept
            _set_weights(None, 0)
            _factors[key] = _read_factors(p, key)
            print(f"style {key}: {len(_factors[key])} layers in {time.time() - t0:.1f} s", flush=True)
        except Exception as e:
            state["error"] = ("Style {s} does not fit: {e}", {"s": LORAS[key][2], "e": type(e).__name__})
            print(f"style {key}: {e!r}", flush=True)
            _paths.pop(key, None)
            return
    elif key == state["key"] and time.time() - state["at"] < 0.3:
        return
    _set_weights(key, amt)
    state.update(key=key, amt=amt, at=time.time(), error=None)


def prime(p):
    """#131: loading and removing a style model once leaves bookkeeping attributes on the model; if that happens after
    compiling, the first style switch makes torch.compile translate everything again (cloud test: 202 s without a
    picture). Done once before compiling – with the smallest style model, whose factors are then kept – it never does."""
    from huggingface_hub import hf_hub_download
    key = "watercolour"
    repo, file, _ = LORAS[key]
    _paths[key] = hf_hub_download(repo, file)
    _factors.clear()
    _factors[key] = _read_factors(p, key)


def forget(p=None):
    """The model is freed or replaced: nothing of it stays here."""
    _factors.clear(); _orig.clear(); _ref_embeds.clear()
    state.update(key=None, amt=0.0)


# ---------- the style reference picture ----------
_ip = {"files": False, "loading": False}


def ip_download():
    """The adapter and its picture encoder into the local cache (about 3 GB the first time)."""
    from huggingface_hub import hf_hub_download, snapshot_download
    repo, sub, file, enc = IP_ADAPTER
    hf_hub_download(repo, f"{sub}/{file}")
    snapshot_download(repo, allow_patterns=[f"{enc}/*"])
    _ip["files"] = True


def ip_load_later(p):
    """First reference picture on this machine: download in the background, load once it is there."""
    if _ip["files"]:
        try:
            ip_ready(p)
        except Exception as e:
            state["error"] = ("Reference picture adapter could not be loaded: {e}", {"e": type(e).__name__})
            print(f"style reference adapter: {e!r}", flush=True)
            _ip["files"] = False
        return
    if _ip["loading"]:
        return

    def run():
        try:
            ip_download()
        except Exception as e:
            state["error"] = ("Reference picture adapter could not be loaded: {e}", {"e": type(e).__name__})
            print(f"style reference adapter download failed: {e!r}", flush=True)
        finally:
            _ip["loading"] = False
            if state["loading"] == "ref":
                state["loading"] = None
    _ip["loading"] = True
    state["loading"] = "ref"
    threading.Thread(target=run, daemon=True, name="style-ref-adapter").start()


def ip_ready(p):
    """Loads the IP-Adapter onto p (once)."""
    if getattr(p, "_dream_ip", False):
        return
    repo, sub, file, enc = IP_ADAPTER
    with _unwrapped(p):
        p.load_ip_adapter(repo, subfolder=sub, weight_name=file, image_encoder_folder=enc)
        # "style only" stays set for good: no picture = a blank embedding. One setting means one compiled variant (#131)
        p.set_ip_adapter_scale(STYLE_ONLY)
    p._dream_ip = True


def add_ref(h, img):
    _refs[h] = img
    while len(_refs) > 4:
        _refs.pop(next(iter(_refs)))


def has_ref(h):
    return h in _refs


@torch.no_grad()
def ip_args(p, h, amt):
    """The pipeline arguments for the reference picture h with strength amt (none: the adapter stays silent)."""
    if not getattr(p, "_dream_ip", False):
        return {}
    on = bool(h) and h in _refs and amt > 0.01
    k = (id(p.unet), h)
    if on and k not in _ref_embeds:
        dev = p.unet.device
        _ref_embeds[k] = p.prepare_ip_adapter_image_embeds([_refs[h]], None, dev, 1, False)[0]
        while len(_ref_embeds) > 4:
            _ref_embeds.pop(next(iter(_ref_embeds)))
    if on:
        e = _ref_embeds[k] * min(1.0, float(amt))     # towards "no picture" (zeros, as the pipeline's own blank)
    else:
        e = torch.zeros((1, 1, p.image_encoder.config.projection_dim), device=p.unet.device, dtype=p.unet.dtype)
    return {"ip_adapter_image_embeds": [e]}
