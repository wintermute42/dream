"""Dance moves of one's own (#236): what the dancer taught Dream by showing it, kept on this Mac.

A move is taught on the page of Dream Dance: three to five repetitions of a rhythmic movement of the hands. What is
kept of it is trajectories, never pictures – per repetition the frames of a dance session (dancelab.py: the features,
what the sources saw of the hands, the points of the skeleton, each with its time), with the hands in body units and
whether the clutch was engaged – and the template the stage recognises the move with (static/dancemoves.js: the mean
way of the hands through one repetition). A move has a name and, if the dancer gave it one, a piece of prompt it
brings along. They live in `~/.local/state/dream/dance/moves/` (never in the repository); only this Mac and Dream
Control may list, read, add, rename or delete them (rights.CONTROL_ONLY), and nothing here ever leaves the Mac.

What a move does is not kept here: that is a row of the mapping table (dance.py) with the source "g.<the move's id>" –
like the built-in gestures. Deleting a move removes its rows.

What comes in is checked before it is kept (fail closed): the format, the sizes, and that the repetitions hold nothing
but numbers, short names and structure."""
import asyncio
import json
import math
import os
import re
import secrets
import time

from fastapi import Request
from fastapi.responses import FileResponse, JSONResponse

import dance
import dancelab
import hub
import i18n
import paths
from web import app

DIR = os.path.join(dancelab.DIR, "moves")
FORMAT, VERSION = "dream-dance-move", 1
MAX_MOVES = 24                                      # as many as the stage looks for at a time (static/dance.js)
MIN_REPS, MAX_REPS = 3, 5
MAX_REP_FRAMES = 64                                 # a repetition lasts at most 1.25 s, at 30 frames a second, and a little
MAX_BYTES = 4 * 1024 * 1024
POINTS = 24                                         # the points of a template (static/dancemoves.js: M)
ID = re.compile(r"m[0-9a-f]{8}")
NAME = re.compile(r"[^\W_][\w .+\-]{0,31}")
PIECE = re.compile(r"[^\x00-\x1f\x7f<>]{0,80}")
MORE = frozenset({"u", "k"})                        # a frame's hands in body units, and whether the clutch was engaged


def _num(v, lo: float, hi: float) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        raise ValueError("number")
    return round(float(v), 4)


def clean_name(name) -> str | None:
    name = " ".join(name.split()) if isinstance(name, str) else ""
    return name if NAME.fullmatch(name) else None


def clean_piece(piece) -> str | None:
    piece = " ".join(piece.split()) if isinstance(piece, str) else None
    return piece if piece is not None and PIECE.fullmatch(piece) else None


def clean_template(t) -> dict:
    """The template as it is kept, or ValueError: a period, the hands it is made with, its points, its tolerance."""
    if not isinstance(t, dict) or t.get("v") != 1 or t.get("hands") not in ("lr", "l", "r"):
        raise ValueError("template")
    pts = t.get("pts")
    if not isinstance(pts, list) or len(pts) != POINTS or not all(isinstance(p, list) and len(p) == 4 for p in pts):
        raise ValueError("points")
    return {"v": 1, "period": _num(t.get("period"), 0.24, 1.5), "hands": t["hands"],
            "pts": [[_num(x, -50, 50) for x in p] for p in pts], "tol": _num(t.get("tol"), 0, 1)}


def clean(m) -> dict | None:
    """A move as it is kept – {"meta": what the list shows and the stage matches with, "reps": the repetitions} – or
    None when it is not one (fail closed: nothing is written)."""
    try:
        if not isinstance(m, dict) or m.get("format") != FORMAT or m.get("version") != VERSION:
            return None
        name, piece, keys, reps = clean_name(m.get("name")), clean_piece(m.get("piece", "")), m.get("keys"), m.get("reps")
        if name is None or piece is None:
            return None
        if not isinstance(keys, list) or len(keys) > 64 or not all(isinstance(k, str) and dancelab.NAME.fullmatch(k) for k in keys):
            return None
        if not isinstance(reps, list) or not MIN_REPS <= len(reps) <= MAX_REPS:
            return None
        out = []
        for rep in reps:
            frames = rep.get("frames") if isinstance(rep, dict) else None
            if not isinstance(frames, list) or not 3 <= len(frames) <= MAX_REP_FRAMES:
                return None
            frames = dancelab.clean_frames(frames, keys, MORE)
            if frames is None or not all(_hands(f.get("u")) for f in frames):
                return None
            out.append({"seconds": float(frames[-1]["t"]), "frames": frames})
        tpl = clean_template(m.get("tpl"))
        return {"meta": {"name": name, "piece": piece, "reps": len(out), "tpl": tpl},
                "reps": {"format": FORMAT, "version": VERSION, "rate": float(dancelab._plain(m.get("rate", 30))),
                         "aspect": float(dancelab._plain(m.get("aspect", 16 / 9))), "keys": keys, "reps": out}}
    except (ValueError, TypeError, OverflowError, RecursionError):
        return None


def _hands(u) -> bool:
    """A frame's hands in body units: [ul, vl, ur, vr], a hand that was not seen as two nulls."""
    return isinstance(u, list) and len(u) == 4 and all(x is None or dancelab._number(x) for x in u)


def _path(mid: str, meta: bool = False) -> str:
    """A move's file – inside the moves' folder, or ValueError."""
    root = os.path.normpath(DIR)
    path = os.path.normpath(os.path.join(root, mid + (".meta.json" if meta else ".json")))
    if not ID.fullmatch(mid) or not path.startswith(root + os.sep):
        raise ValueError(mid)
    return path


def _read_meta(mid: str) -> dict | None:
    """What is kept about a move – looked at again when it is read: a file can be changed by hand."""
    try:
        with open(_path(mid, True)) as f:
            m = json.load(f)
        name, piece = clean_name(m.get("name")), clean_piece(m.get("piece", ""))
        if m.get("id") != mid or name is None or piece is None:
            return None
        return {"id": mid, "name": name, "piece": piece, "at": int(_num(m.get("at", 0), 0, 1e11)),
                "reps": int(_num(m.get("reps", MIN_REPS), 1, MAX_REPS)), "tpl": clean_template(m.get("tpl"))}
    except (OSError, ValueError, TypeError, AttributeError, RecursionError):
        return None


def listing() -> list:
    """The moves, the oldest first (read from their small notes, never the repetitions themselves)."""
    try:
        names = sorted(n[:-len(".meta.json")] for n in os.listdir(DIR) if n.endswith(".meta.json"))
    except OSError:
        return []
    out = [m for m in (_read_meta(n) for n in names if ID.fullmatch(n)) if m]
    return sorted(out, key=lambda m: (m["at"], m["id"]))[:MAX_MOVES]


def save(m: dict) -> dict:
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    mid = "m" + secrets.token_hex(4)
    meta = {"id": mid, "at": int(time.time()), **m["meta"]}
    dancelab._write(_path(mid), m["reps"])
    dancelab._write(_path(mid, True), meta)
    return meta


def change(mid: str, new) -> dict | None:
    """A move's name and its piece of prompt, from a page: what is given and valid is taken. The move, or None."""
    meta = _read_meta(mid) if ID.fullmatch(mid) else None
    if meta is None or not isinstance(new, dict):
        return None
    name = clean_name(new["name"]) if "name" in new else meta["name"]
    piece = clean_piece(new["piece"]) if "piece" in new else meta["piece"]
    if name is None or piece is None:
        return None
    meta.update(name=name, piece=piece)
    dancelab._write(_path(mid, True), meta)
    return meta


def delete(mid: str) -> bool:
    """The move goes, and with it the rows of the mapping tables and the sets that had it as their source."""
    if not ID.fullmatch(mid):
        return False
    done = False
    for path in (_path(mid), _path(mid, True)):
        try:
            os.remove(path)
            done = True
        except OSError:
            pass
    if done:
        dance.drop_source("g." + mid)
    return done


async def _tell(tables: bool = False) -> None:
    """This Mac and Dream Control hear which moves there are now (a guest has no use for them); when rows went with a
    move, everyone hears the tables as after any change of them."""
    dancelab._tell({"moves": listing()})
    if tables:
        await hub.broadcast(dance.msg())


def _take(body: bytes) -> dict | None:
    m = clean(dancelab._json(body))
    return save(m) if m else None


@app.get("/dance/moves")
async def moves_list():
    return {"moves": listing(), "folder": paths.shown(DIR)}


@app.post("/dance/moves")
async def moves_add(request: Request):
    body = await dancelab._body(request, MAX_BYTES)
    if body is None:
        return JSONResponse({"error": i18n.t("That is not a dance move.")}, status_code=422)
    if len(listing()) >= MAX_MOVES:
        return JSONResponse({"error": i18n.t("Too many moves are kept – delete one first.")}, status_code=409)
    meta = await asyncio.to_thread(_take, body)
    if meta is None:
        return JSONResponse({"error": i18n.t("That is not a dance move.")}, status_code=422)
    await _tell()
    return meta


@app.get("/dance/moves/{mid}")
async def moves_get(mid: str):
    if not ID.fullmatch(mid) or not os.path.isfile(_path(mid)):
        return JSONResponse({"error": i18n.t("This move does not exist.")}, status_code=404)
    return FileResponse(_path(mid), media_type="application/json", headers={"Cache-Control": "no-store"})


@app.post("/dance/moves/{mid}")
async def moves_change(mid: str, request: Request):
    if not ID.fullmatch(mid) or _read_meta(mid) is None:
        return JSONResponse({"error": i18n.t("This move does not exist.")}, status_code=404)
    body = await dancelab._body(request, MAX_BYTES)
    meta = change(mid, dancelab._json(body)) if body is not None else None
    if meta is None:
        return JSONResponse({"error": i18n.t("A name: letters, digits, spaces and . + - , at most 32 characters.")}, status_code=422)
    await _tell()
    return meta


@app.delete("/dance/moves/{mid}")
async def moves_delete(mid: str):
    if not ID.fullmatch(mid) or not delete(mid):
        return JSONResponse({"error": i18n.t("This move does not exist.")}, status_code=404)
    await _tell(tables=True)
    return {"ok": True}
