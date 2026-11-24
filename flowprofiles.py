"""Flowtrack's performers (#253): what Dream learned of one person's way of moving, kept on this Mac.

A profile is learned on the page of Flowtrack from a session of the dance lab's format (dancelab.py: trajectories,
never pictures) – recorded before or taken live. What is kept of it is far less than the session: the name the user
chose ("Anna – Poi"), what the person plays with, and numbers – how fast, how wide and how high the person moves,
how they turn and in which plane, their tempo, the energy over the session, how far they reach in the camera picture
– and up to three figures they come back to, each as the template of a taught move (dancemoves.py). The format:
static/flowprofile.js, which also learns and uses it; the stage fits the feature stream and Flowtrack's automatic to
the profile chosen with the setting `flow_profile`.

A profile is personal data. The profiles live in `~/.local/state/dream/dance/profiles/` (never in the repository);
only this Mac and Dream Control may list, add, rename, export or delete them (rights.CONTROL_ONLY), and nothing here
ever leaves the Mac. An export is a copy in `~/.local/state/dream/dance/exports/` and nowhere else – where it goes
from there (another Mac, a private place) is the owner's step.

What comes in is checked before it is kept (fail closed): the format, every number's range, and that it holds nothing
but numbers, the name and a few fixed words – a profile cannot carry a picture."""
import asyncio
import json
import math
import os
import re
import secrets
import time

from fastapi import Request
from fastapi.responses import JSONResponse

import dancelab
import dancemoves
import hub
import i18n
import paths
from web import app

DIR = os.path.join(dancelab.DIR, "profiles")
FORMAT, VERSION = "dream-flow-profile", 1
MAX_PROFILES = 48
MAX_FIGURES = 3                                     # static/flowprofile.js MAX_FIGURES
BINS = 24                                           # … and BINS: the points of the energy curve
MAX_BYTES = 64 * 1024
PROPS = ("poi", "staff", "hoop", "fans", "hands", "other")
KINDS = ("hand", "marker", "on")                    # the kinds of detection a person can be learned with (settings: flow_kind)
ID = re.compile(r"p[0-9a-f]{8}")
NAME = re.compile(r"[^\W_][\w .+'–\-]{0,31}")       # a move's name, and a dash and an apostrophe: "Anna – Poi"


def _num(v, lo: float, hi: float) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise ValueError("number")
    return round(float(v), 4)


def _table(v, keys: dict) -> dict:
    """A table of numbers with exactly these keys, each in its range – or ValueError."""
    if not isinstance(v, dict) or set(v) != set(keys):
        raise ValueError("table")
    return {k: _num(v[k], *keys[k]) for k in keys}


def _maybe(v, keys: dict) -> dict | None:
    return None if v is None else _table(v, keys)


def clean_name(name) -> str | None:
    name = " ".join(name.split()) if isinstance(name, str) else ""
    return name if NAME.fullmatch(name) else None


UNIT = (0.0, 1.0)


def clean_stats(s) -> dict:
    """What was measured of the person, as it is kept – or ValueError."""
    if not isinstance(s, dict) or set(s) != {"seconds", "total", "speed", "energy", "turn", "open", "height", "tempo", "planes",
                                             "round", "pair", "arm", "curve", "view"}:
        raise ValueError("stats")
    view, curve, bpm = s["view"], s["curve"], (20.0, 400.0)
    if not isinstance(view, dict) or set(view) != {"reach", "gap", "kind"} or view["kind"] not in KINDS:
        raise ValueError("view")
    if not isinstance(curve, list) or len(curve) != BINS:
        raise ValueError("curve")
    return {"seconds": _num(s["seconds"], 0, 1e5), "total": _num(s["total"], 0, 1e5),
            "speed": _table(s["speed"], {"lo": (0, 100), "mid": (0, 100), "hi": (0, 100)}),
            "energy": _table(s["energy"], {"hi": UNIT}),
            "turn": _table(s["turn"], {"hi": (0, 50), "dir": (-1, 1), "share": UNIT}),
            "open": _maybe(s["open"], {"lo": UNIT, "hi": UNIT}), "height": _maybe(s["height"], {"lo": UNIT, "hi": UNIT}),
            "tempo": _maybe(s["tempo"], {"lo": bpm, "mid": bpm, "hi": bpm, "share": UNIT}),
            "planes": _table(s["planes"], {"wall": UNIT, "wheel": UNIT, "floor": UNIT}), "round": _num(s["round"], 0, 1),
            "pair": _maybe(s["pair"], {"rigid": UNIT, "share": UNIT}), "arm": _maybe(s["arm"], {"spin": UNIT, "force": UNIT}),
            "curve": [_num(x, 0, 1) for x in curve],
            "view": {"reach": _num(view["reach"], 0, 2), "gap": _num(view["gap"], 0, 60), "kind": view["kind"]}}


def clean(p) -> dict | None:
    """A profile as it is kept, or None when it is not one (fail closed: nothing is written)."""
    try:
        if not isinstance(p, dict) or p.get("format") != FORMAT or p.get("version") != VERSION:
            return None
        name, figures = clean_name(p.get("name")), p.get("figures")
        if name is None or p.get("prop") not in PROPS or not isinstance(figures, list) or len(figures) > MAX_FIGURES:
            return None
        if not all(isinstance(f, dict) and set(f) == {"tpl", "share"} for f in figures):
            return None
        return {"format": FORMAT, "version": VERSION, "name": name, "prop": p["prop"], "stats": clean_stats(p.get("stats")),
                "figures": [{"tpl": dancemoves.clean_template(f["tpl"]), "share": _num(f["share"], 0, 1)} for f in figures]}
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        return None


def _path(pid: str) -> str:
    """A profile's file – inside the profiles' folder, or ValueError."""
    root = os.path.normpath(DIR)
    path = os.path.normpath(os.path.join(root, pid + ".json"))
    if not ID.fullmatch(pid) or not path.startswith(root + os.sep):
        raise ValueError(pid)
    return path


def read(pid: str) -> dict | None:
    """A kept profile with its id and when it was learned – looked at again when it is read: a file can be changed by
    hand."""
    try:
        with open(_path(pid)) as f:
            raw = json.load(f)
        p = clean(raw)
        return {"id": pid, "at": int(_num(raw.get("at", 0), 0, 1e11)), **p} if p else None
    except (OSError, ValueError, TypeError, AttributeError, RecursionError):
        return None


def listing() -> list:
    """The profiles, the oldest first – whole: a profile is small, and the stage uses what the list says."""
    try:
        names = sorted(n[:-len(".json")] for n in os.listdir(DIR) if n.endswith(".json"))
    except OSError:
        return []
    out = [p for p in (read(n) for n in names if ID.fullmatch(n)) if p]
    return sorted(out, key=lambda p: (p["at"], p["id"]))[:MAX_PROFILES]


def save(p: dict) -> dict:
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    pid = "p" + secrets.token_hex(4)
    dancelab._write(_path(pid), {"at": int(time.time()), **p})
    return read(pid)


def change(pid: str, new) -> dict | None:
    """A profile's name and what the person plays with, from a page: what is given and valid is taken. The profile, or
    None."""
    p = read(pid) if ID.fullmatch(pid) else None
    if p is None or not isinstance(new, dict):
        return None
    name = clean_name(new["name"]) if "name" in new else p["name"]
    prop = new["prop"] if "prop" in new else p["prop"]
    if name is None or prop not in PROPS:
        return None
    p.update(name=name, prop=prop)
    dancelab._write(_path(pid), {k: v for k, v in p.items() if k != "id"})
    return p


def delete(pid: str) -> bool:
    if not ID.fullmatch(pid):
        return False
    try:
        os.remove(_path(pid))
        return True
    except OSError:
        return False


def export(pid: str) -> str | None:
    """A copy of the profile in the exports folder beside the sessions' test files – its path, or None. The file's name
    is made of the profile's id alone (the person's name is inside, nowhere in a path)."""
    p = read(pid) if ID.fullmatch(pid) else None
    if p is None:
        return None
    root = os.path.normpath(dancelab.exports_dir())
    path = os.path.normpath(os.path.join(root, f"flow-profile-{pid}.json"))
    if not path.startswith(root + os.sep):
        raise ValueError(pid)
    os.makedirs(root, mode=0o700, exist_ok=True)
    dancelab._write(path, {k: v for k, v in p.items() if k not in ("id", "at")})
    return path


def _tell() -> None:
    """This Mac and Dream Control hear which profiles there are now (a guest has no use for them)."""
    dancelab._tell({"profiles": listing()})


def _take(body: bytes) -> dict | None:
    p = clean(dancelab._json(body))
    return save(p) if p else None


@app.get("/flow/profiles")
async def profiles_list():
    return {"profiles": listing(), "folder": paths.shown(DIR)}


@app.post("/flow/profiles")
async def profiles_add(request: Request):
    body = await dancelab._body(request, MAX_BYTES)
    if body is None:
        return JSONResponse({"error": i18n.t("That is not a performer’s profile.")}, status_code=422)
    if len(listing()) >= MAX_PROFILES:
        return JSONResponse({"error": i18n.t("Too many profiles are kept – delete one first.")}, status_code=409)
    p = await asyncio.to_thread(_take, body)
    if p is None:
        return JSONResponse({"error": i18n.t("That is not a performer’s profile.")}, status_code=422)
    _tell()
    return p


@app.post("/flow/profiles/{pid}")
async def profiles_change(pid: str, request: Request):
    if not ID.fullmatch(pid) or read(pid) is None:
        return JSONResponse({"error": i18n.t("This profile does not exist.")}, status_code=404)
    body = await dancelab._body(request, MAX_BYTES)
    p = change(pid, dancelab._json(body)) if body is not None else None
    if p is None:
        return JSONResponse({"error": i18n.t("A name: letters, digits, spaces and . + - ' , at most 32 characters.")}, status_code=422)
    _tell()
    return p


@app.post("/flow/profiles/{pid}/export")
async def profiles_export(pid: str):
    path = await asyncio.to_thread(export, pid) if ID.fullmatch(pid) else None
    if path is None:
        return JSONResponse({"error": i18n.t("This profile does not exist.")}, status_code=404)
    return {"file": paths.shown(path), "folder": paths.shown(dancelab.exports_dir())}


@app.delete("/flow/profiles/{pid}")
async def profiles_delete(pid: str):
    if not ID.fullmatch(pid) or not delete(pid):
        return JSONResponse({"error": i18n.t("This profile does not exist.")}, status_code=404)
    if hub.state.get("flow_profile") == pid:        # the profile in use is gone: Flowtrack goes on without one
        await hub.apply({"flow_profile": ""})
    _tell()
    return {"ok": True}
