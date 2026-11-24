"""The dance lab's sessions (#243): what the lab records of a dance, kept on this Mac.

A session is trajectories, never pictures: per frame the features the stage detected, what its sources saw of the
hands and the body (points and confidences) and the points of the skeleton – with marks ("good"/"bad") and the mapping
table that was in use (the format: static/dancerec.js). A feedback moment is a short session of its own: the last
seconds before a "good" or a "bad". They live in `~/.local/state/dream/dance/` (never in the repository), only this Mac
and Dream Control may list, read, add or delete them (rights.CONTROL_ONLY), and nothing here ever leaves the Mac.

What comes in is checked before it is kept: the format, the sizes, and that it holds nothing but numbers, short names
and structure – a session cannot carry a picture."""
import json
import math
import os
import re
import secrets
import time

from fastapi import Request
from fastapi.responses import JSONResponse

import dance
import hub
import i18n
import outbox
import paths
import rights
from web import app

DIR = os.path.join(paths.state_dir(), "dance")
MAX_BYTES = 24 * 1024 * 1024               # a full recording (five minutes) is about 8 MB
MAX_FRAMES = 9500                          # five minutes at 30 a second, and a little
MAX_SESSIONS = 500
FORMAT, VERSION = "dream-dance", 1
ID = re.compile(r"\d{8}-\d{6}-[0-9a-f]{4}")
NAME = re.compile(r"[a-z][a-z0-9_.+]{0,39}")


def _plain(x, depth: int = 0):
    """Numbers (finite), short names, true/false/nothing, and lists and tables of them – or ValueError. A frame is
    made of these alone; a long text (a picture as text) is not one of them."""
    if x is None or isinstance(x, bool):
        return x
    if isinstance(x, (int, float)):
        if not -1e9 < x < 1e9 or not math.isfinite(x):
            raise ValueError("number")
        return x
    if isinstance(x, str):
        if not NAME.fullmatch(x):
            raise ValueError("text")
        return x
    if depth > 6:
        raise ValueError("depth")
    if isinstance(x, list):
        if len(x) > 64:
            raise ValueError("list")
        return [_plain(v, depth + 1) for v in x]
    if isinstance(x, dict):
        if len(x) > 64 or not all(isinstance(k, str) and NAME.fullmatch(k) for k in x):
            raise ValueError("table")
        return {k: _plain(v, depth + 1) for k, v in x.items()}
    raise ValueError("type")


def _mark(m) -> dict:
    if not isinstance(m, dict) or m.get("mark") not in ("good", "bad"):
        raise ValueError("mark")
    by = m.get("by")
    return {"t": float(_plain(m.get("t", 0))), "mark": m["mark"], "by": by if isinstance(by, str) and NAME.fullmatch(by) else "",
            "secs": min(max(float(_plain(m.get("secs", 4))), 0.0), 60.0)}


def clean(s) -> dict | None:
    """A session as it is kept, or None when it is not one (fail closed: nothing is written)."""
    try:
        if not isinstance(s, dict) or s.get("format") != FORMAT or s.get("version") != VERSION:
            return None
        if s.get("kind") not in ("session", "feedback"):
            return None
        frames, keys, marks = s.get("frames"), s.get("keys"), s.get("marks")
        if not isinstance(frames, list) or not 0 < len(frames) <= MAX_FRAMES:
            return None
        if not isinstance(keys, list) or len(keys) > 64 or not all(isinstance(k, str) and NAME.fullmatch(k) for k in keys):
            return None
        if not isinstance(marks, list) or len(marks) > 500:
            return None
        out = []
        for f in frames:
            if not isinstance(f, dict) or set(f) - {"t", "v", "c", "g", "gc", "s", "b", "o", "i", "p"}:
                return None
            f = _plain(f)
            if not isinstance(f.get("t"), (int, float)) or isinstance(f["t"], bool) or f["t"] < 0:
                return None
            if not all(isinstance(f.get(k), list) and len(f[k]) == len(keys) for k in ("v", "c")):
                return None
            out.append(f)
        return {"format": FORMAT, "version": VERSION, "kind": s["kind"], "rate": float(_plain(s.get("rate", 30))),
                "aspect": float(_plain(s.get("aspect", 16 / 9))), "seconds": float(out[-1]["t"]), "keys": keys, "frames": out,
                "marks": [_mark(m) for m in marks], "map": dance.clean_rows(s.get("map"))}
    except (ValueError, TypeError, OverflowError, RecursionError):
        return None


def about(sid: str, s: dict) -> dict:
    """What the list shows of a session: when, how long, its marks, and – for a feedback moment – what was recognised
    and what the movement steered in its seconds."""
    count, top = {}, {}
    for f in s["frames"]:
        if isinstance(f.get("g"), str):
            count[f["g"]] = count.get(f["g"], 0) + 1
        for k, v in (f.get("o") or {}).items() if isinstance(f.get("o"), dict) else ():
            if isinstance(v, (int, float)):
                top[k] = max(top.get(k, 0.0), abs(v))
    g = max(count, key=count.get) if count else None
    return {"id": sid, "kind": s["kind"], "at": int(time.time()), "seconds": round(s["seconds"], 2), "frames": len(s["frames"]),
            "good": sum(m["mark"] == "good" for m in s["marks"]), "bad": sum(m["mark"] == "bad" for m in s["marks"]),
            "gesture": g if g and count[g] >= 0.3 * len(s["frames"]) else None,
            "targets": sorted(top, key=top.get, reverse=True)[:3]}


def _path(sid: str, meta: bool = False) -> str:
    return os.path.join(DIR, sid + (".meta.json" if meta else ".json"))


def save(s: dict) -> dict:
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    sid = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    meta = about(sid, s)
    for path, data in ((_path(sid), s), (_path(sid, True), meta)):
        with open(os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            json.dump(data, f, separators=(",", ":"))
        os.replace(path + ".tmp", path)
    return meta


def listing() -> list:
    """The sessions, the newest first (read from their small notes, never the sessions themselves)."""
    out = []
    try:
        names = sorted((n for n in os.listdir(DIR) if n.endswith(".meta.json")), reverse=True)
    except OSError:
        return out
    for n in names[:MAX_SESSIONS]:
        try:
            with open(os.path.join(DIR, n)) as f:
                m = json.load(f)
            if isinstance(m, dict) and ID.fullmatch(str(m.get("id"))) and m["id"] + ".meta.json" == n:
                out.append(m)
        except (OSError, ValueError):
            continue
    return out


def delete(sid: str) -> bool:
    done = False
    for path in (_path(sid), _path(sid, True)):
        try:
            os.remove(path)
            done = True
        except OSError:
            pass
    return done


def _tell(note: dict) -> None:
    """Dream Control and this Mac hear that something was kept or removed (a guest has no use for it)."""
    data = json.dumps({"dance": note})
    for c in list(hub.clients):
        if rights.can(hub.roles.get(c), "control"):
            outbox.post(c, data)


@app.get("/dance/sessions")
async def sessions_list():
    return {"sessions": listing(), "folder": paths.shown(DIR)}


@app.post("/dance/sessions")
async def sessions_add(request: Request):
    try:
        if int(request.headers.get("content-length") or 0) > MAX_BYTES:
            raise ValueError
        body = b""
        async for chunk in request.stream():           # never more than a session can be, whatever the header said
            body += chunk
            if len(body) > MAX_BYTES:
                raise ValueError
        s = clean(json.loads(body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError())))
    except (ValueError, RecursionError, UnicodeDecodeError):
        s = None
    if s is None:
        return JSONResponse({"error": i18n.t("That is not a dance session.")}, status_code=422)
    if len(listing()) >= MAX_SESSIONS:
        return JSONResponse({"error": i18n.t("Too many dance sessions are kept – delete some first.")}, status_code=409)
    meta = save(s)
    _tell({"saved": meta})
    return meta


@app.get("/dance/sessions/{sid}")
async def sessions_get(sid: str):
    if not ID.fullmatch(sid) or not os.path.isfile(_path(sid)):
        return JSONResponse({"error": i18n.t("This dance session does not exist.")}, status_code=404)
    with open(_path(sid)) as f:
        return JSONResponse(json.load(f), headers={"Cache-Control": "no-store"})


@app.delete("/dance/sessions/{sid}")
async def sessions_delete(sid: str):
    if not ID.fullmatch(sid) or not delete(sid):
        return JSONResponse({"error": i18n.t("This dance session does not exist.")}, status_code=404)
    _tell({"deleted": sid})
    return {"ok": True}
