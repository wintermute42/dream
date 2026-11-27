"""Base movements of one's own (#267): faders the dancer taught Dream by showing two or more states of the body
("upright" ↔ "deep in the knees"), kept on this Mac.

A fader is taught on the page of Dream Dance (static/faderteach.js on static/dancefaders.js): the dancer names the
states and holds each one for a moment; Dream learns a small regression from what the body showed – body values
normalised to the body, never a picture. What is kept is that regression and the names: per body value its middle,
its weight and its share in the fader, the states' names and values, and how the states came out. Nothing of the
frames themselves, no picture. They live in `~/.local/state/dream/dance/faders/` (never in the repository); only this
Mac and Dream Control may list, add, rename, teach again or delete them (rights.CONTROL_ONLY), and nothing here ever
leaves the Mac.

What a fader does is not kept here: that is a base sentence of a movement set (dance.py) with the source
"f.<the fader's id>" – like a built-in base movement. Deleting a fader empties the sentences that had it.

What comes in is checked before it is kept (fail closed): the format, the sizes, and that it holds nothing but
numbers, short names and structure."""
import asyncio
import json
import math
import os
import re
import secrets
import time

from fastapi import Request
from fastapi.responses import JSONResponse

import dance
import dancelab
import hub
import i18n
import paths
from web import app

DIR = os.path.join(dancelab.DIR, "faders")
FORMAT, VERSION = "dream-dance-fader", 1
MODEL = 1                                           # static/dancefaders.js VERSION
MAX_FADERS = 12                                     # as many as the stage reads at a time (static/dance.js MAX_FADERS)
MIN_STATES, MAX_STATES = 2, 5
MAX_BYTES = 64 * 1024
MAX_W = 1e4
ID = re.compile(r"f[0-9a-f]{8}")
NAME = re.compile(r"[^\W_][\w .+\-]{0,31}")
# the body values a fader may be read from (static/dancefaders.js KEYS)
POINTS = ("head", "elbow_l", "elbow_r", "wrist_l", "wrist_r", "hip_l", "hip_r", "knee_l", "knee_r", "ankle_l", "ankle_r")
KEYS = tuple(f"{p}.{a}" for p in POINTS for a in ("u", "v")) + ("tilt", "hand_l.u", "hand_l.v", "hand_r.u", "hand_r.v")


def _num(v, lo: float, hi: float) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise ValueError("number")
    return round(float(v), 5)


def clean_name(name) -> str | None:
    name = " ".join(name.split()) if isinstance(name, str) else ""
    return name if NAME.fullmatch(name) else None


def clean_model(md) -> dict:
    """The regression as it is kept, or ValueError: the body values it reads, their middle, weight and share, the
    offset, and where each state came out."""
    if not isinstance(md, dict) or md.get("v") != MODEL:
        raise ValueError("model")
    keys = md.get("keys")
    if not isinstance(keys, list) or not 1 <= len(keys) <= len(KEYS) or not all(isinstance(k, str) and k in KEYS for k in keys) or len(set(keys)) != len(keys):
        raise ValueError("keys")
    n = len(keys)

    def nums(name, lo, hi):
        a = md.get(name)
        if not isinstance(a, list) or len(a) != n:
            raise ValueError(name)
        return [_num(x, lo, hi) for x in a]

    states = md.get("states")
    if not isinstance(states, list) or not MIN_STATES <= len(states) <= MAX_STATES or not all(isinstance(s, dict) for s in states):
        raise ValueError("states")
    return {"v": MODEL, "keys": list(keys), "m": nums("m", -50, 50), "w": nums("w", -MAX_W, MAX_W), "b": _num(md.get("b"), -MAX_W, MAX_W),
            "share": nums("share", 0, 1), "states": [{"y": _num(s.get("y"), 0, 1), "at": _num(s.get("at"), -1, 2)} for s in states]}


def clean_states(states, model: dict) -> list:
    """The states' names and values – as many as the model has, the same values, rising from 0 to 1 – or ValueError."""
    if not isinstance(states, list) or len(states) != len(model["states"]):
        raise ValueError("states")
    out = []
    for s, m in zip(states, model["states"]):
        name = clean_name(s.get("name")) if isinstance(s, dict) else None
        if name is None or _num(s.get("y"), 0, 1) != m["y"]:
            raise ValueError("state")
        out.append({"name": name, "y": m["y"]})
    ys = [s["y"] for s in out]
    if ys[0] != 0 or ys[-1] != 1 or any(b <= a for a, b in zip(ys, ys[1:])):
        raise ValueError("order")
    return out


def clean(f) -> dict | None:
    """A fader as it is kept – {"name", "states": [{"name", "y"}], "model"} – or None when it is not one (fail closed:
    nothing is written)."""
    try:
        if not isinstance(f, dict) or f.get("format") != FORMAT or f.get("version") != VERSION:
            return None
        name = clean_name(f.get("name"))
        if name is None:
            return None
        model = clean_model(f.get("model"))
        return {"name": name, "states": clean_states(f.get("states"), model), "model": model}
    except (ValueError, TypeError, AttributeError, OverflowError, RecursionError):
        return None


def _path(fid: str) -> str:
    """A fader's file – inside the faders' folder, or ValueError."""
    root = os.path.normpath(DIR)
    path = os.path.normpath(os.path.join(root, fid + ".json"))
    if not ID.fullmatch(fid) or not path.startswith(root + os.sep):
        raise ValueError(fid)
    return path


def read(fid: str) -> dict | None:
    """A fader as it is kept – looked at again when it is read: a file can be changed by hand."""
    try:
        with open(_path(fid)) as f:
            got = json.load(f)
        if not isinstance(got, dict) or got.get("id") != fid:
            return None
        c = clean({**got, "format": FORMAT, "version": VERSION})
        return {"id": fid, "at": int(_num(got.get("at", 0), 0, 1e11)), **c} if c else None
    except (OSError, ValueError, TypeError, AttributeError, RecursionError, UnicodeDecodeError):
        return None


def listing() -> list:
    """The faders, the oldest first."""
    try:
        names = sorted(n[:-len(".json")] for n in os.listdir(DIR) if n.endswith(".json"))
    except OSError:
        return []
    out = [f for f in (read(n) for n in names if ID.fullmatch(n)) if f]
    return sorted(out, key=lambda f: (f["at"], f["id"]))[:MAX_FADERS]


def save(c: dict, fid: str | None = None, at: int | None = None) -> dict:
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    fid = fid or "f" + secrets.token_hex(4)
    kept = {"id": fid, "at": at if at is not None else int(time.time()), **c}
    dancelab._write(_path(fid), kept)
    return kept


def change(fid: str, new) -> dict | None:
    """A fader from a page: another name, or taught again (new states and a new regression – its sentences stay). The
    fader, or None."""
    was = read(fid) if ID.fullmatch(fid) else None
    if was is None or not isinstance(new, dict):
        return None
    if "model" in new:
        c = clean({"format": FORMAT, "version": VERSION, "name": new.get("name", was["name"]), "states": new.get("states"), "model": new["model"]})
    else:
        name = clean_name(new.get("name"))
        c = {"name": name, "states": was["states"], "model": was["model"]} if name else None
    return save(c, fid, was["at"]) if c else None


def delete(fid: str) -> bool:
    """The fader goes, and with it the base sentences of the sets that had it."""
    if not ID.fullmatch(fid):
        return False
    try:
        os.remove(_path(fid))
    except OSError:
        return False
    dance.drop_source("f." + fid)
    return True


async def _tell(tables: bool = False) -> None:
    """This Mac and Dream Control hear which faders there are now; when sentences went with one, everyone hears the
    sets and tables as after any change of them."""
    dancelab._tell({"faders": listing()})
    if tables:
        await hub.broadcast(dance.msg())


def _take(body: bytes) -> dict | None:
    c = clean(dancelab._json(body))
    return save(c) if c else None


@app.get("/dance/faders")
async def faders_list():
    return {"faders": listing(), "folder": paths.shown(DIR)}


@app.post("/dance/faders")
async def faders_add(request: Request):
    body = await dancelab._body(request, MAX_BYTES)
    if body is None:
        return JSONResponse({"error": i18n.t("That is not a base movement.")}, status_code=422)
    if len(listing()) >= MAX_FADERS:
        return JSONResponse({"error": i18n.t("Too many base movements are kept – delete one first.")}, status_code=409)
    kept = await asyncio.to_thread(_take, body)
    if kept is None:
        return JSONResponse({"error": i18n.t("That is not a base movement.")}, status_code=422)
    await _tell()
    return kept


@app.post("/dance/faders/{fid}")
async def faders_change(fid: str, request: Request):
    if not ID.fullmatch(fid) or read(fid) is None:
        return JSONResponse({"error": i18n.t("This base movement does not exist.")}, status_code=404)
    body = await dancelab._body(request, MAX_BYTES)
    kept = change(fid, dancelab._json(body)) if body is not None else None
    if kept is None:
        return JSONResponse({"error": i18n.t("That is not a base movement.")}, status_code=422)
    await _tell()
    return kept


@app.delete("/dance/faders/{fid}")
async def faders_delete(fid: str):
    if not ID.fullmatch(fid) or not delete(fid):
        return JSONResponse({"error": i18n.t("This base movement does not exist.")}, status_code=404)
    await _tell(tables=True)
    return {"ok": True}
