"""Dance steers the dream (#235): the mapping table – which movement does what – as data, kept in one file.

The stage detects the movement (static/dance.js: a stream of continuous features and gestures) and applies the table
every frame (static/dancemap.js); this module owns the table: its built-in rows, what a row may say, and the file
`~/.config/dream/dance.json` the owner's changes are kept in (never in the repository). A row:

  {"id": "throw", "on": true, "src": "g.throw", "dst": "fx.feedback", "curve": "lin",
   "in": [0, 1], "out": [0, 1], "smooth": 0.15, "origin": "fixed"}

`src` is a name in the feature stream (a feature, "g.<gesture>", "<hand>.<finger value>"; gestures taught later and
glove sensors add names of the same kind), `dst` a target of the one interface for the instant layer and the AI
sliders, `origin` who filled the row: "fixed" (built in), "own" (set by hand), "taught" (a taught gesture) or
"learned" (learned by showing) – all of them are rows of this one table.
Nothing here loads PyTorch."""
import json
import math
import os
import re

import paths
import playlists

MAP_FILE = os.path.join(paths.config_dir(), "dance.json")
MAX_ROWS = 64
CURVES = ("lin", "soft", "hard", "s")
ORIGINS = ("fixed", "own", "taught", "learned")
# the one target interface: the instant layer (an effect's amount, all effects, the beat's push, turning) and the slow
# AI sliders (added on top of the slider)
TARGETS = (("fx.amt", "fx.pulse", "fx.spin") + tuple("fx." + e for e in playlists.FX)
           + ("ai.strength", "ai.mix", "ai.zoom", "ai.rot", "ai.hue"))
SRC = re.compile(r"[a-z][a-z0-9_]{0,23}(\.[a-z0-9_]{1,24})?")
ID = re.compile(r"[a-z0-9_-]{1,24}")


def _row(id_, src, dst, *, lo=0.0, hi=1.0, out=1.0, curve="lin", smooth=0.15, on=True):
    return {"id": id_, "on": on, "src": src, "dst": dst, "curve": curve, "in": [lo, hi], "out": [0.0, out],
            "smooth": smooth, "origin": "fixed"}


# What a movement does until the owner changes it. Two continuous rows are always at work (energy, opening – each can
# be switched off), the gestures add their accents, the movement's own beat pushes the effects, turning turns them.
DEFAULT_ROWS = [
    _row("energy", "energy", "fx.trails", lo=0.1, hi=0.8, out=0.7, curve="soft", smooth=0.2),
    _row("open", "open", "fx.kaleido", lo=0.45, hi=0.95, out=0.8, curve="s", smooth=0.25),
    _row("throw", "g.throw", "fx.feedback", out=1.0),
    _row("accordion", "g.accordion", "fx.tunnel", out=1.0),
    _row("push", "g.push", "fx.rgb", out=1.0),
    _row("circle", "g.circle", "fx.mandala", out=1.0),
    _row("wave", "g.wave", "fx.waves", out=1.0),
    _row("pulse", "pulse", "fx.pulse", out=1.0, smooth=0.0),
    {**_row("turn", "turn", "fx.spin", lo=-1.0, hi=1.0, smooth=0.2), "out": [-1.0, 1.0]},
]


def _num(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not -1e300 < v < 1e300 or not math.isfinite(v):
        raise ValueError
    return round(min(max(float(v), lo), hi), 4)


def clean_row(row) -> dict | None:
    """A row as the table keeps it, or None when it says something a row cannot say (fail closed: it is dropped)."""
    try:
        if not isinstance(row, dict) or not all(isinstance(row.get(k), str) for k in ("id", "src", "dst")):
            return None
        if not ID.fullmatch(row["id"]) or not SRC.fullmatch(row["src"]) or row["dst"] not in TARGETS:
            return None
        rng = {}
        for k, (lo, hi) in (("in", (-1.0, 1.0)), ("out", (-1.0, 1.0))):
            pair = row.get(k, [0.0, 1.0])
            if not isinstance(pair, list) or len(pair) != 2:
                return None
            rng[k] = [_num(pair[0], lo, hi), _num(pair[1], lo, hi)]
        return {"id": row["id"], "on": row.get("on") is not False, "src": row["src"], "dst": row["dst"],
                "curve": row["curve"] if row.get("curve") in CURVES else "lin", **rng,
                "smooth": _num(row.get("smooth", 0.15), 0.0, 5.0),
                "origin": row["origin"] if row.get("origin") in ORIGINS else "own"}
    except (ValueError, TypeError, OverflowError):
        return None


def clean_rows(rows) -> list:
    out, seen = [], set()
    for row in rows[:MAX_ROWS * 4] if isinstance(rows, list) else ():
        r = clean_row(row)
        if r and r["id"] not in seen and len(out) < MAX_ROWS:
            seen.add(r["id"])
            out.append(r)
    return out


def load_rows() -> list:
    """The owner's table, or the built-in one while there is none (or the file is broken)."""
    try:
        with open(MAP_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("rows"), list):
            return clean_rows(data["rows"])
    except (FileNotFoundError, ValueError, OSError, RecursionError):
        pass
    return [dict(r) for r in DEFAULT_ROWS]


def save_rows(rows: list) -> None:
    os.makedirs(os.path.dirname(MAP_FILE), exist_ok=True)
    tmp = MAP_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"version": 1, "rows": rows}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, MAP_FILE)


rows: list = load_rows()


def set_rows(new) -> list:
    """The table from a page: "reset" brings the built-in rows back (the file goes), a list replaces the table."""
    global rows
    if new == "reset":
        try:
            os.remove(MAP_FILE)
        except OSError:
            pass
        rows = [dict(r) for r in DEFAULT_ROWS]
    elif isinstance(new, list):
        rows = clean_rows(new)
        save_rows(rows)
    return rows


def msg() -> dict:
    return {"dance": {"map": rows}}
