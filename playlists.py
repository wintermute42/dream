"""Playlists: scenes with optional settings, journeys, the surprise playlist, editing and AI-made playlists.

A playlist in playlists.json (shipped) or ~/.config/dream/playlists.json (the owner's own, wins on equal names) is
  - a list of scenes, or
  - a journey: {"journey": true, "fade": 8, "scenes": [...]} – played in order (never shuffled), an arc from a
    calm start over a peak to a calm end, with long soft transitions.
A scene is a prompt string or {"prompt": "...", "strength": 0.6, "drift": 0.4, "hue": 6, "zoom": 0.02, "rot": 0.5,
"mix": 0.3, "fx": "tunnel+waves", "fx_amt": 0.8, "pattern": "Flow", "secs": 40} – every key but the prompt is optional.

The names used to be German (#133): OLD_NAMES and friends map them, so saved settings, scenes and the owner's own
playlists written before keep working.
"""
import json
import os
import random
import re
import urllib.request

import paths
from midi import FX

USER_FILE = os.path.join(paths.config_dir(), "playlists.json")
SURPRISE = "✨ Surprise"
AI_PREFIX = "AI: "                 # the name of a playlist made from a keyword
# #133: the German names of earlier versions → the English ones
OLD_NAMES = {"Psychedelisch": "Psychedelic", "Feuer": "Fire", "Wasser": "Water", "Kosmos": "Cosmos", "Ruhe": "Calm",
             "Natur": "Nature", "Stadt": "City", "Mythen": "Myths", "Tiefsee": "Deep sea", "Kristall": "Crystal",
             "Organisch": "Organic", "Figuren": "Figures", "Abstrakt": "Abstract", "Reise: Ozean": "Journey: Ocean",
             "Reise: Feuer": "Journey: Fire", "Reise: Kosmos": "Journey: Cosmos", "✨ Überraschung": SURPRISE}   # German names
OLD_PATTERNS = {"Puls": "Pulse", "Ruck": "Jolt", "Sprung": "Jump", "Fluss": "Flow"}
OLD_STYLES = {"aquarell": "watercolour", "wachsmal": "crayon", "papier": "papercut"}
OFF = ("", "off", "none", "-", "aus")      # "aus" (German "off") from earlier scenes still switches off


def new_name(name: str) -> str:
    """A playlist name of an earlier version in today's English (other names stay as they are)."""
    if name.startswith("KI: "):
        return AI_PREFIX + name[4:]
    return OLD_NAMES.get(name, name)
# scene settings that may change the shared state, with their allowed range
SETTINGS = {"strength": (0.15, 0.95), "drift": (0.0, 1.0), "hue": (0.0, 20.0), "zoom": (-0.04, 0.06),
            "rot": (-3.0, 3.0), "mix": (0.0, 0.9), "fx_amt": (0.0, 1.0), "style_amt": (0.0, 2.0), "style_ref_amt": (0.0, 1.0)}
# picture styles (#123, style models for SDXL-Turbo; the same keys as styles.LORAS): "style=watercolour", "style=off"
# for none; a style reference picture by its id: "style_ref=3f2a9c0d1e4b" (pictures in ~/.local/state/dream/refs)
PICTURE_STYLES = ("watercolour", "crayon", "pixel", "papercut", "sticker", "illustration")
# effects of a scene: "fx=tunnel+waves" (names as in static/fx.js), "fx=off" switches them off


def _fx(v):
    v = str(v).strip().lower()
    if v in OFF:
        return ""
    names = [e for e in dict.fromkeys(v.split("+")) if e in FX]
    return "+".join(names) if names else None
PATTERNS = ("Pulse", "Jolt", "Jump", "Flow")
DEFAULT_FADE = 3.0          # seconds a scene change blends from the old prompt into the new one
JOURNEY_FADE = 8.0
STYLES = ["watercolor painting", "oil painting with thick brush strokes", "ink drawing, japanese style",
          "stained glass", "neon glow", "low poly 3d render", "infrared photography", "pastel colors",
          "cinematic lighting", "dreamy soft focus", "art nouveau ornaments", "glitch art", "golden hour light",
          "bauhaus shapes", "pencil sketch", "holographic iridescent"]


def read_file(path: str) -> dict:
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, ValueError, OSError):
        return {}


def load(here: str, temp: dict | None = None) -> dict:
    """Shipped playlists, the owner's own (win on equal names) and the temporary AI playlists of this run."""
    lists = read_file(os.path.join(here, "playlists.json"))
    lists.update({new_name(k): v for k, v in read_file(USER_FILE).items()})   # #133: own versions of German names
    lists.update(temp or {})
    return lists


def names(here: str, temp: dict | None = None) -> list:
    return sorted(load(here, temp)) + [SURPRISE]


TEMP_MAX = 5


def keep_temp(temp: dict, name: str, prompts: list) -> None:
    """AI playlists live only in memory until Dream restarts; at most TEMP_MAX, the oldest goes first."""
    temp.pop(name, None)
    temp[name] = prompts
    while len(temp) > TEMP_MAX:
        temp.pop(next(iter(temp)))


def _num(v, lo, hi):
    try:
        return min(hi, max(lo, float(v)))
    except (TypeError, ValueError):
        return None


def scene(item) -> dict | None:
    """Normalises a scene: {"prompt", "settings", "pattern", "secs"}; None if it has no prompt."""
    if isinstance(item, str):
        item = {"prompt": item}
    if not isinstance(item, dict) or not str(item.get("prompt", "")).strip():
        return None
    settings = {k: n for k, (lo, hi) in SETTINGS.items() if k in item and (n := _num(item[k], lo, hi)) is not None}
    if "fx" in item and (fx := _fx(item["fx"])) is not None:
        settings["fx"] = fx
    if "style" in item:
        st = str(item["style"]).strip().lower()
        st = OLD_STYLES.get(st, st)
        if st in OFF:
            settings["style"] = ""
        elif st in PICTURE_STYLES:
            settings["style"] = st
    if "style_ref" in item:
        ref = str(item["style_ref"]).strip().lower()
        if ref in OFF:
            settings["style_ref"] = ""
        elif re.fullmatch(r"[0-9a-f]{12}", ref):
            settings["style_ref"] = ref
    pattern = OLD_PATTERNS.get(item.get("pattern"), item.get("pattern"))
    pattern = pattern if pattern in PATTERNS else None
    secs = _num(item.get("secs"), 5, 600)
    return {"prompt": str(item["prompt"]).strip()[:500], "settings": settings, "pattern": pattern,
            "secs": int(secs) if secs else None}


def playlist(entry) -> tuple:
    """(scenes, journey, fade) of a playlist entry."""
    journey = isinstance(entry, dict) and bool(entry.get("journey"))
    items = entry.get("scenes", []) if isinstance(entry, dict) else entry if isinstance(entry, list) else []
    fade = _num(entry.get("fade"), 0, 30) if isinstance(entry, dict) else None
    if fade is None:
        fade = JOURNEY_FADE if journey else DEFAULT_FADE
    return [s for s in (scene(i) for i in items) if s], journey, fade


def surprise(lists: dict, rng=random) -> dict | None:
    """A random scene from a random playlist, with one or two random style additions."""
    pool = [s for e in lists.values() for s in playlist(e)[0]]
    if not pool:
        return None
    s = dict(rng.choice(pool))
    s["prompt"] = s["prompt"] + ", " + ", ".join(rng.sample(STYLES, rng.choice((1, 2))))
    return s


# ---------- editing: one scene per line, "prompt | strength=0.6 drift=0.3 pattern=Flow secs=40" ----------
def to_text(entry) -> str:
    scenes, journey, fade = playlist(entry)
    lines = ["# Journey" + (f" fade={fade:g}" if fade != JOURNEY_FADE else "")] if journey else []
    for s in scenes:
        opts = [f"{k}={v or 'off'}" if k in ("fx", "style", "style_ref") else f"{k}={v:g}" for k, v in s["settings"].items()]
        if s["pattern"]:
            opts.append(f"pattern={s['pattern']}")
        if s["secs"]:
            opts.append(f"secs={s['secs']}")
        lines.append(s["prompt"] + (" | " + " ".join(opts) if opts else ""))
    return "\n".join(lines)


def from_text(text: str):
    """Parses the editor text; returns a plain list or a journey dict (empty list if nothing usable)."""
    journey, fade, items = False, None, []
    for raw in str(text).splitlines()[:200]:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            if re.match(r"#\s*(journey|reise)", line, re.I):     # "# Reise": the German word of earlier versions
                journey = True
                m = re.search(r"fade=([\d.]+)", line)
                fade = float(m.group(1)) if m else None
            continue
        prompt, _, opts = line.partition("|")
        item = {"prompt": prompt.strip()}
        for k, v in re.findall(r"(\w+)\s*=\s*([^\s]+)", opts):
            item[k] = v
        if (s := scene(item)) is None:
            continue
        out = {"prompt": s["prompt"], **s["settings"]}
        if s["pattern"]:
            out["pattern"] = s["pattern"]
        if s["secs"]:
            out["secs"] = s["secs"]
        items.append(out if len(out) > 1 else out["prompt"])
    if journey:
        return {"journey": True, **({"fade": fade} if fade is not None else {}), "scenes": items}
    return items


def save_user(name: str, entry) -> None:
    """Stores (or with entry None removes) a playlist in the owner's own file – never in the repository."""
    data = {new_name(k): v for k, v in read_file(USER_FILE).items()}   # #133: stored under today's names
    if entry is None:
        data.pop(name, None)
    else:
        data[name] = entry
    os.makedirs(os.path.dirname(USER_FILE), exist_ok=True)
    tmp = USER_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, USER_FILE)


def clean_name(name: str) -> str:
    name = re.sub(r"[\x00-\x1f]", "", str(name)).strip()[:60]
    return "" if name == SURPRISE else name


# ---------- AI playlist from a keyword (local model via Ollama) ----------
def generate(topic: str, ollama: str, model: str, count: int = 8, timeout: int = 90) -> list:
    """Asks the local language model for image prompts about the topic; raises OSError if it is not reachable."""
    ask = (f"Write {count} different, vivid prompts for an AI image generator on the theme: {topic}.\n"
           "Each prompt in English, 8 to 20 words, visual details only (motif, light, colours, material), "
           "no names of real people or brands. Make them varied: some calm, some wild. "
           "Answer with one prompt per line, no numbering, no quotes, nothing else.")
    body = json.dumps({"model": model, "stream": False, "options": {"temperature": 0.9}, "prompt": ask}).encode()
    req = urllib.request.Request(ollama + "/api/generate", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        text = json.load(r).get("response", "")
    return parse_lines(text, count)


def parse_lines(text: str, count: int = 8) -> list:
    out = []
    for line in str(text).splitlines():
        line = re.sub(r"^\s*(\d+[.)]|[-*•])\s*", "", line).strip().strip('"').strip()
        if len(line.split()) >= 4 and not line.endswith(":"):
            out.append(line[:300])
    return out[:count]
