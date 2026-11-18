"""Voice and words: a spoken wish is transcribed on this Mac (Whisper on MLX) and rewritten into an English prompt by a
small local Ollama model; the same model finds what "calm" and "wild" mean for the current prompt."""
import asyncio
import json
import os
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from fastapi import File, Form, UploadFile
from fastapi.responses import JSONResponse

import config
from web import app


def to_english_prompt(text: str) -> str:
    """Asks a small local Ollama model for a short English image prompt; falls back to the transcript."""
    body = json.dumps({"model": config.PROMPT_MODEL, "stream": False, "options": {"temperature": 0.4},
                       "prompt": "Rewrite the following as one short, vivid English prompt for an image generator "
                                 "(max 30 words, visual details only, no quotes, no explanation):\n\n" + text}).encode()
    try:
        req = urllib.request.Request(config.OLLAMA + "/api/generate", data=body, headers={"Content-Type": "application/json"})
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
    return mlx_whisper.transcribe(path, path_or_hf_repo=config.WHISPER)


# ---------- energy words: what "calm" and "wild" mean for the current prompt (direct touch, part C) ----------
_energy_cache: dict = {}
ENERGY_FALLBACK = {"calm": "calm, still, soft gentle light", "wild": "wild storm, bursting sparks, explosive motion"}


def energy_words(prompt: str) -> dict:
    ask = ("For this image prompt, give two short English additions of 3 to 6 words: one that makes the scene "
           "calm and still, one that makes the same scene wild and energetic, using elements that belong to it "
           "(for an ocean: calm = 'glassy calm sea, soft mist', wild = 'raging storm, crashing waves, foam').\n"
           "Prompt: " + prompt + "\nAnswer exactly in two lines:\ncalm: ...\nwild: ...")
    body = json.dumps({"model": config.PROMPT_MODEL, "stream": False, "options": {"temperature": 0.5}, "prompt": ask}).encode()
    try:
        req = urllib.request.Request(config.OLLAMA + "/api/generate", data=body, headers={"Content-Type": "application/json"})
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
