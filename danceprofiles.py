"""A dancer's own measures (#266): where their calm and their wild lie, per base movement – kept per person.

The base movements of Dream Dance (energy, open, turn, height: static/dance.js) come out of the feature stream as raw
numbers, and the sentences read them through ranges Dream picks for an average dancer (dance.BASE_SHAPE: "from where to
where it counts"). One dancer's calm is another's warm-up. The learning assistant on the page of Dream Dance measures a
dancer (static/dancecal.js: ten seconds calm, ten seconds wild, arms closed and wide open, arms up, turning once) and
finds their lower and upper bound per base movement; a profile keeps them under the dancer's name. While a profile is
in use the engine reads the dance's frame through it (static/dancemap.js `calibrate`): the dancer's calm is where the
standard calm is, their wild where the standard wild is – every row of the dance table, the rules (groups, budget,
minimum) as they are. "Standard measures" (no profile) is the built-in ranges, and nothing is remapped.

A profile is numbers and a short name, nothing else: {"bounds": {"energy": [lo, hi], "open": …, "turn": …, "height": …}}
(turning goes both ways; its bounds are how far, 0 … 1). They live in `~/.config/dream/dance-profiles.json` (never in
the repository); the one in use is the setting `dance_profile` too ("" – the standard measures). A broken or unknown
file, a bound that is no number or a range too narrow to act: the standard measures stand (fail closed). Nothing here
loads PyTorch."""
import json
import math
import os

import dance
import paths
import settings

FILE = os.path.join(paths.config_dir(), "dance-profiles.json")
VERSION = 1
FEATURES = dance.BASE_SOURCES                        # energy, open, turn, height – the base movements
MAX_PROFILES = 16
MIN_SPAN = 0.08                                      # a range narrower than this would make every flicker a jump
NAME = settings.SET_NAME                             # a person's name: the same short plain names as a set's


def _standard() -> dict:
    """The built-in ranges: the ones the sentences of the base movements read (dance.BASE_SHAPE); turning by how far."""
    out = {}
    for k in FEATURES:
        lo, hi = dance.BASE_SHAPE[k][:2]
        out[k] = [0.0, max(abs(lo), abs(hi))] if lo < 0 else [float(lo), float(hi)]
    return out


STANDARD = _standard()


def clean_name(name) -> str | None:
    name = " ".join(name.split()) if isinstance(name, str) else ""
    return name if NAME.fullmatch(name) else None


def _pair(v) -> list | None:
    if not isinstance(v, list) or len(v) != 2:
        return None
    if any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in v):
        return None
    lo, hi = (round(float(x), 4) for x in v)
    return [lo, hi] if 0.0 <= lo and hi <= 1.0 and hi - lo >= MIN_SPAN - 1e-9 else None


def clean_bounds(data) -> dict | None:
    """The bounds as a profile keeps them – every base movement, the standard one where the measure says nothing
    usable – or None when it is no measure at all (not a dict, or not one bound of its own)."""
    if not isinstance(data, dict):
        return None
    out = {k: _pair(data.get(k)) for k in FEATURES}
    if not any(out.values()):
        return None
    return {k: v or list(STANDARD[k]) for k, v in out.items()}


def _load() -> tuple:
    """(the profiles, the one in use) – none and the standard measures while there is no file or it is broken."""
    try:
        with open(FILE) as f:
            data = json.load(f)
    except (OSError, ValueError, RecursionError, UnicodeDecodeError):
        return {}, ""
    if not isinstance(data, dict) or data.get("version") != VERSION or not isinstance(data.get("profiles"), dict):
        return {}, ""
    out = {}
    for name, p in list(data["profiles"].items())[:MAX_PROFILES]:
        b = clean_bounds(p.get("bounds")) if isinstance(p, dict) else None
        if clean_name(name) == name and b:
            out[name] = {"bounds": b}
    use = data.get("use")
    return out, use if isinstance(use, str) and use in out else ""


def _keep() -> None:
    """The file with the profiles – or no file, when there are none."""
    if not profiles:
        try:
            os.remove(FILE)
        except OSError:
            pass
        return
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    tmp = FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"version": VERSION, "use": use, "profiles": profiles}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, FILE)


profiles, use = _load()


def reload() -> None:
    """The file as it is now (a test, a new sandbox)."""
    global profiles, use
    profiles, use = _load()


def bounds_now() -> dict | None:
    """The bounds that act: the profile's in use, or None – the standard measures."""
    return profiles[use]["bounds"] if use in profiles else None


def choose(name) -> bool:
    """The profile in use from now on ("" – the standard measures). A name that is no profile changes nothing."""
    global use
    if name != "" and name not in profiles:
        return False
    if name != use:
        use = name
        _keep()
    return True


def save(name, bounds) -> bool:
    """A dancer's measures under their name – a new profile, or the same dancer measured anew – in use from now on."""
    global use
    name, b = clean_name(name), clean_bounds(bounds)
    if name is None or b is None or (name not in profiles and len(profiles) >= MAX_PROFILES):
        return False
    profiles[name] = {"bounds": b}
    use = name
    _keep()
    return True


def delete(name) -> bool:
    """A profile goes; when it was in use, the standard measures act."""
    global use
    if not isinstance(name, str) or name not in profiles:
        return False
    del profiles[name]
    if use == name:
        use = ""
    _keep()
    return True


def msg() -> dict:
    """For the pages: the profiles' bounds, the one in use, and the standard ranges they are read onto."""
    return {"dance": {"profiles": {"use": use, "names": list(profiles), "data": {k: v["bounds"] for k, v in profiles.items()},
                                   "std": STANDARD, "min": MIN_SPAN}}}
