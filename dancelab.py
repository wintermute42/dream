"""The dance lab's sessions (#243): what the lab records of a dance, kept on this Mac.

A session is trajectories, never pictures: per frame the features the stage detected, what its sources saw of the
hands and the body (points and confidences), the points of the skeleton and (#196) the motion sensor's raw values with
their times – with marks ("good"/"bad") and the mapping
table that was in use (the format: static/dancerec.js). A feedback moment is a short session of its own: the last
seconds before a "good" or a "bad". They live in `~/.local/state/dream/dance/` (never in the repository), only this Mac
and Dream Control may list, read, add or delete them (rights.CONTROL_ONLY), and nothing here ever leaves the Mac.

A test file for the detection made of a session (the lab's ⬇) is the owner's real movement too: it is written to
`~/.local/state/dream/dance/exports/` and nowhere else – never into Dream's code folder, never into another repository.
Where it goes from there (a private place) is the owner's step.

What comes in is checked before it is kept: the format, the sizes, and that it holds nothing but numbers, short names
and structure – a session cannot carry a picture."""
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
import hub
import i18n
import outbox
import paths
import rights
from web import app

DIR = os.path.join(paths.state_dir(), "dance")
MAX_BYTES = 24 * 1024 * 1024               # a full recording (five minutes, both hands' fingers) is about 12 MB
MAX_FRAMES = 9500                          # five minutes at 30 a second, and a little
MAX_SESSIONS = 500
FORMAT, VERSION = "dream-dance", 1
ID = re.compile(r"[0-9]{8}-[0-9]{6}-[0-9a-f]{4}")
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


def _number(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _mark(m) -> dict:
    if not isinstance(m, dict) or m.get("mark") not in ("good", "bad"):
        raise ValueError("mark")
    by = m.get("by")
    return {"t": float(_plain(m.get("t", 0))), "mark": m["mark"], "by": by if isinstance(by, str) and NAME.fullmatch(by) else "",
            "secs": min(max(float(_plain(m.get("secs", 4))), 0.0), 60.0)}


FRAME_KEYS = frozenset({"t", "v", "c", "g", "gc", "s", "b", "o", "i", "p"})


RAW_MAX = 32                               # #196: raw sensor values in one frame at most (static/dancerec.js)


def raw_ok(r) -> bool:
    """#196: a frame's raw sensor values – none, or [[seconds before the frame (≤ 0), kind 0…3, x, y, z], …]."""
    return r is None or (isinstance(r, list) and len(r) <= RAW_MAX and all(
        isinstance(v, list) and len(v) == 5 and all(_number(x) for x in v) and v[0] <= 0 and v[1] in (0, 1, 2, 3) for v in r))


def clean_frames(frames: list, keys: list, more: frozenset = frozenset()) -> list | None:
    """The frames of a session as they are kept – numbers, short names and structure alone –, or None when one of
    them is no frame. `more`: further keys a frame may have (#236: a taught move's frames)."""
    out = []
    for f in frames:
        if not isinstance(f, dict) or set(f) - FRAME_KEYS - more:
            return None
        f = _plain(f)
        if not isinstance(f.get("t"), (int, float)) or isinstance(f["t"], bool) or f["t"] < 0:
            return None
        if not all(isinstance(f.get(k), list) and len(f[k]) == len(keys) and all(_number(x) for x in f[k]) for k in ("v", "c")):
            return None
        if out and f["t"] < out[-1]["t"]:           # time runs forward: the player looks frames up by it
            return None
        i, p = f.get("i"), f.get("p")               # what the detector was fed, and the points to draw
        if not isinstance(i, dict) or not isinstance(p, dict) or not isinstance(i.get("f"), dict):
            return None
        if not isinstance(i.get("h"), dict) or not all(isinstance(i["h"].get(h), list) for h in ("l", "r")):
            return None
        if not all(p.get(k) is None or (isinstance(p[k], list) and all(_number(x) for x in p[k])) for k in ("b", "l", "r")):
            return None
        if not raw_ok(i.get("r")):
            return None
        out.append(f)
    return out


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
        out = clean_frames(frames, keys)
        if out is None:
            return None
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


def clean_test(t, sid: str) -> dict | None:
    """A test file for the detection (static/dancerec.js `testFile`) as it is written, or None when it is not one:
    what the detector was fed, frame by frame, and what is expected of it – numbers and short names alone."""
    try:
        if not isinstance(t, dict) or t.get("format") != FORMAT + "-test" or t.get("version") != VERSION:
            return None
        frames, expect = t.get("frames"), t.get("expect")
        if not isinstance(frames, list) or not 0 < len(frames) <= MAX_FRAMES or not isinstance(expect, list) or len(expect) > 500:
            return None
        out, lines = [], []
        for f in frames:
            if not isinstance(f, dict) or set(f) != {"t", "i", "p"}:
                return None
            f = _plain(f)
            if not _number(f["t"]) or f["t"] < 0 or not isinstance(f["i"], dict) or not isinstance(f["p"], dict):
                return None
            out.append(f)
        for e in expect:
            if not isinstance(e, dict) or set(e) != {"t0", "t1", "mark", "was", "want"} or e["mark"] not in ("good", "bad"):
                return None
            e = _plain(e)
            if not _number(e["t0"]) or not _number(e["t1"]) or not all(e[k] is None or isinstance(e[k], str) for k in ("was", "want")):
                return None
            lines.append(e)
        return {"format": FORMAT + "-test", "version": VERSION, "name": sid, "rate": float(_plain(t.get("rate", 30))),
                "aspect": float(_plain(t.get("aspect", 16 / 9))), "seconds": float(out[-1]["t"]), "frames": out, "expect": lines}
    except (ValueError, TypeError, OverflowError, RecursionError):
        return None


def exports_dir() -> str:
    """Where test files made of sessions are written: beside the sessions in the state folder, nowhere else."""
    return os.path.join(DIR, "exports")


def export(sid: str, t: dict) -> str:
    """Write a session's test file; its path. The name is made of the session's id alone."""
    root = os.path.normpath(exports_dir())
    path = os.path.normpath(os.path.join(root, f"dance-{sid}.json"))
    if not ID.fullmatch(sid) or not path.startswith(root + os.sep):
        raise ValueError(sid)
    os.makedirs(root, mode=0o700, exist_ok=True)
    _write(path, t)
    return path


def _write(path: str, data: dict) -> None:
    with open(os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(path + ".tmp", path)


def _path(sid: str, meta: bool = False) -> str:
    """A session's file – inside the sessions' folder, or ValueError (an id is checked before; this holds whatever comes)."""
    root = os.path.normpath(DIR)
    path = os.path.normpath(os.path.join(root, sid + (".meta.json" if meta else ".json")))
    if not ID.fullmatch(sid) or not path.startswith(root + os.sep):
        raise ValueError(sid)
    return path


def save(s: dict) -> dict:
    os.makedirs(DIR, mode=0o700, exist_ok=True)
    sid = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    meta = about(sid, s)
    for path, data in ((_path(sid), s), (_path(sid, True), meta)):
        _write(path, data)
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
    if not ID.fullmatch(sid):
        return False
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
    for c in list(hub.clients):
        role = hub.roles.get(c)
        msg = rights.scrub(role, {"dance": note}) if rights.can(role, "control") else None   # #266, #267: names only with "names"
        if msg:
            outbox.post(c, json.dumps(msg, ensure_ascii=False))


@app.get("/dance/sessions")
async def sessions_list():
    return {"sessions": listing(), "folder": paths.shown(DIR)}


def _json(body: bytes):
    """What a request's body holds, or None (not JSON, or a number that is none: NaN, Infinity)."""
    try:
        return json.loads(body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, RecursionError, UnicodeDecodeError):
        return None


def _take(body: bytes) -> dict | None:
    """The session in a request's body, checked and kept – or None. Run beside the event loop: a long session takes
    half a second to check, and nothing else of Dream waits for it."""
    s = clean(_json(body))
    return save(s) if s else None


def _take_test(sid: str, body: bytes) -> str | None:
    """The test file in a request's body, checked and written to the exports folder – its path, or None."""
    t = clean_test(_json(body), sid)
    return export(sid, t) if t else None


async def _body(request: Request, limit: int | None = None) -> bytes | None:
    """A request's body – never more than a session can be (or `limit` bytes), whatever the header said; None when it
    is empty or too large."""
    limit = MAX_BYTES if limit is None else limit
    chunks, size = [], 0
    if int(request.headers.get("content-length") or 0) <= limit:
        async for chunk in request.stream():
            chunks.append(chunk)
            size += len(chunk)
            if size > limit:
                break
    return b"".join(chunks) if chunks and size <= limit else None


@app.post("/dance/sessions")
async def sessions_add(request: Request):
    body = await _body(request)
    if body is None:
        return JSONResponse({"error": i18n.t("That is not a dance session.")}, status_code=422)
    if len(listing()) >= MAX_SESSIONS:
        return JSONResponse({"error": i18n.t("Too many dance sessions are kept – delete some first.")}, status_code=409)
    meta = await asyncio.to_thread(_take, body)
    if meta is None:
        return JSONResponse({"error": i18n.t("That is not a dance session.")}, status_code=422)
    _tell({"saved": meta})
    return meta


@app.get("/dance/sessions/{sid}")
async def sessions_get(sid: str):
    if not ID.fullmatch(sid) or not os.path.isfile(_path(sid)):
        return JSONResponse({"error": i18n.t("This dance session does not exist.")}, status_code=404)
    return FileResponse(_path(sid), media_type="application/json", headers={"Cache-Control": "no-store"})


@app.post("/dance/sessions/{sid}/export")
async def sessions_export(sid: str, request: Request):
    """A session's test file for the detection (made by the lab from the session), written to the exports folder in
    the state folder. It is real movement: Dream writes it nowhere else."""
    if not ID.fullmatch(sid) or not os.path.isfile(_path(sid)):
        return JSONResponse({"error": i18n.t("This dance session does not exist.")}, status_code=404)
    body = await _body(request)
    path = await asyncio.to_thread(_take_test, sid, body) if body is not None else None
    if path is None:
        return JSONResponse({"error": i18n.t("That is not a test file of a dance session.")}, status_code=422)
    return {"file": paths.shown(path), "folder": paths.shown(exports_dir())}


@app.delete("/dance/sessions/{sid}")
async def sessions_delete(sid: str):
    if not ID.fullmatch(sid) or not delete(sid):
        return JSONResponse({"error": i18n.t("This dance session does not exist.")}, status_code=404)
    _tell({"deleted": sid})
    return {"ok": True}
