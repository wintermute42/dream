"""Movement steers the dream (#235, #249): the mapping tables – which movement does what – as data, kept in one file.

The stage detects the movement (static/dance.js: a stream of continuous features and gestures, fed by every source of
the register – static/movement.js) and applies a table every frame (static/dancemap.js); this module owns the tables:
one per movement mode (#249: a mode is nothing but its table – mood, flowtrack, dance), their built-in rows, what a
row may say, and the file `~/.config/dream/dance.json` the owner's changes are kept in (never in the repository). A row:

  {"id": "throw", "on": true, "src": "g.throw", "dst": "fx.feedback", "curve": "lin",
   "in": [0, 1], "out": [0, 1], "smooth": 0.15, "origin": "fixed"}

`src` is a name in the feature stream (a feature, "g.<gesture>", "<hand>.<finger value>", "present": someone is
there; gestures taught later and glove sensors add names of the same kind), `dst` a target of the one interface for
the instant layer, the direct interaction and the AI sliders, `origin` who filled the row: "fixed" (built in), "own"
(set by hand), "taught" (a taught gesture) or "learned" (learned by showing) – all of them are rows of these tables.
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
MODES = ("mood", "flowtrack", "dance")              # the movement modes that have a table ("off" has none)
# the one target interface: the instant layer (an effect's amount, all effects, the beat's push, turning, the tempo of
# the picture's own motion, how calm the dream is), the direct interaction (#249: what the hands do to the picture –
# paint, stir, impulses, light in the dark, and whether movement shapes the effects) and the slow AI sliders (added on
# top of the slider; "ai.prompt": the prompt between its calm and its wild words, "ai.react": speed and place of the
# movement push transformation, zoom, rotation and colour drift; #236 "ai.piece": the piece of prompt a taught move
# brings along, blended in by as much as the row says)
TARGETS = (("fx.amt", "fx.pulse", "fx.spin", "fx.speed") + tuple("fx." + e for e in playlists.FX)
           + ("stage.calm", "touch.paint", "touch.warp", "touch.impulse", "touch.light", "touch.shape")
           + ("ai.strength", "ai.mix", "ai.zoom", "ai.rot", "ai.hue", "ai.prompt", "ai.react", "ai.piece"))
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


# #249: the direct interaction as rows – part of the flowtrack and of the dance preset. While someone is there the
# hands paint, stir and set off impulses and the movement shapes the effects; the energy blends the prompt between
# its calm and its wild words. Light in the dark and the push on the AI sliders wait to be switched on.
TOUCH_ROWS = [
    _row("paint", "present", "touch.paint", smooth=0.3),
    _row("warp", "present", "touch.warp", smooth=0.3),
    _row("impulse", "present", "touch.impulse", smooth=0.3),
    _row("light", "present", "touch.light", smooth=0.3, on=False),
    _row("shape", "present", "touch.shape", smooth=0.3),
    _row("content", "energy", "ai.prompt", lo=0.05, hi=0.7, smooth=0.6),
    _row("react", "present", "ai.react", on=False),
]
# #249: the mood – only energy and stillness, no gestures. Energy acts at once on the pulse, the afterglow and the
# picture's tempo, gently on the transformation and the prompt; a still room calms the dream.
MOOD_ROWS = [
    _row("pulse", "energy", "fx.pulse", lo=0.15, hi=0.9, out=0.8, curve="soft", smooth=0.1),
    _row("glow", "energy", "fx.trails", lo=0.1, hi=0.8, out=0.6, curve="soft", smooth=0.3),
    _row("speed", "energy", "fx.speed", lo=0.05, hi=0.8, smooth=0.3),
    _row("change", "energy", "ai.strength", lo=0.1, hi=0.9, out=0.5, smooth=1.5),
    _row("content", "energy", "ai.prompt", lo=0.1, hi=0.8, smooth=2.0),
    _row("calm", "still", "stage.calm", lo=0.5, hi=1.0, smooth=3.0),
]
# #251: movement sets – named tables for the dance, to choose from in a show (the panel, a MIDI button, a playlist
# scene). The built-in ones; the owner's own are kept beside the tables in the file. "standard" is the built-in table.
SET_ROWS = {
    "waves": [
        _row("energy", "energy", "fx.waves", lo=0.1, hi=0.8, out=0.8, curve="soft", smooth=0.25),
        _row("open", "open", "fx.tunnel", lo=0.45, hi=0.95, out=0.7, curve="s", smooth=0.3),
        _row("wave", "g.wave", "fx.trails", out=1.0),
        _row("circle", "g.circle", "fx.mandala", out=1.0),
        _row("accordion", "g.accordion", "fx.mirror", out=1.0),
        _row("pulse", "pulse", "fx.pulse", out=0.7, smooth=0.0),
        {**_row("turn", "turn", "fx.spin", lo=-1.0, hi=1.0, smooth=0.3), "out": [-1.0, 1.0]},
    ],
    "fire": [
        _row("energy", "energy", "fx.feedback", lo=0.15, hi=0.85, out=0.8, curve="soft", smooth=0.2),
        _row("height", "height", "fx.rgb", lo=0.55, hi=1.0, out=0.6, curve="hard", smooth=0.2),
        _row("throw", "g.throw", "fx.trails", out=1.0),
        _row("push", "g.push", "fx.waves", out=1.0),
        _row("circle", "g.circle", "fx.kaleido", out=1.0),
        _row("pulse", "pulse", "fx.pulse", out=1.0, smooth=0.0),
        {**_row("turn", "turn", "fx.spin", lo=-1.0, hi=1.0, smooth=0.2), "out": [-1.0, 1.0]},
    ],
}
MAX_SETS = 24
SET_NAME = re.compile(r"[\w][\w .+-]{0,23}")

# #252: a wristband (or a phone on the arm) in flowtrack – no gestures, only what the arm does: its energy quickens the
# picture, its rotation turns the effects, the pull on a swung arm (centrifugal force) turns the colours. The rows
# rest while no sensor sends (their sources are not known then); they combine with fire and LEDs in the camera.
BAND_ROWS = [
    _row("armspeed", "energy", "fx.speed", lo=0.1, hi=0.8, out=0.6, smooth=0.3),
    {**_row("armspin", "spin", "fx.spin", lo=-1.0, hi=1.0, smooth=0.25), "out": [-0.8, 0.8]},
    _row("armforce", "force", "fx.hue", lo=0.1, hi=0.9, out=0.8, curve="soft", smooth=0.4),
]
DEFAULT_TABLES = {"mood": MOOD_ROWS, "flowtrack": TOUCH_ROWS + BAND_ROWS, "dance": DEFAULT_ROWS + TOUCH_ROWS}


def default_tables() -> dict:
    return {m: [dict(r) for r in rows] for m, rows in DEFAULT_TABLES.items()}


def builtin_sets() -> dict:
    """The built-in movement sets: the built-in table as "standard", and the others with the rows of the direct
    interaction every dance table has."""
    return {"standard": [dict(r) for r in DEFAULT_TABLES["dance"]],
            **{name: [dict(r) for r in rows + TOUCH_ROWS] for name, rows in SET_ROWS.items()}}


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


def load_tables() -> dict:
    """The owner's tables, or the built-in ones while there are none (or the file is broken). A file of the version
    before the modes (#235: one table, "rows") is the dance table; the rows of the direct interaction join it."""
    out = default_tables()
    try:
        with open(MAP_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("tables"), dict):
            out.update({m: clean_rows(data["tables"][m]) for m in MODES if isinstance(data["tables"].get(m), list)})
        elif isinstance(data, dict) and isinstance(data.get("rows"), list):
            rows = clean_rows(data["rows"])
            have = {r["id"] for r in rows}
            out["dance"] = (rows + [dict(r) for r in TOUCH_ROWS if r["id"] not in have])[:MAX_ROWS]
    except (FileNotFoundError, ValueError, OSError, RecursionError):
        pass
    return out


def load_sets() -> dict:
    """The owner's own movement sets (#251), or none."""
    try:
        with open(MAP_FILE) as f:
            data = json.load(f)
        got = data.get("sets") if isinstance(data, dict) else None
        if isinstance(got, dict):
            return {k: clean_rows(v) for k, v in list(got.items())[:MAX_SETS * 4]
                    if isinstance(k, str) and SET_NAME.fullmatch(k) and k not in builtin_sets() and isinstance(v, list)}
    except (FileNotFoundError, ValueError, OSError, RecursionError):
        pass
    return {}


def is_current() -> bool:
    """Whether the file already has a table per mode (#249)."""
    try:
        with open(MAP_FILE) as f:
            data = json.load(f)
        return isinstance(data, dict) and isinstance(data.get("tables"), dict)
    except (FileNotFoundError, ValueError, OSError, RecursionError):
        return False


def save_tables() -> None:
    os.makedirs(os.path.dirname(MAP_FILE), exist_ok=True)
    tmp = MAP_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"version": 2, "tables": tables, **({"sets": sets} if sets else {})}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, MAP_FILE)


tables: dict = load_tables()
sets: dict = dict(list(load_sets().items())[:MAX_SETS])


def all_sets() -> dict:
    """Every movement set by name: the built-in ones first, then the owner's."""
    return {**builtin_sets(), **sets}


def use_set(name: str) -> bool:
    """#251: the dance table becomes this set's rows (a copy: tuning the table never changes the set)."""
    rows = all_sets().get(name) if isinstance(name, str) else None
    if rows is None:
        return False
    set_rows([dict(r) for r in rows], "dance")
    return True


def save_set(name) -> bool:
    """The dance table as it is now, kept as a set of this name (an own set of that name is replaced; a built-in one
    is never overwritten)."""
    if not isinstance(name, str) or not SET_NAME.fullmatch(name) or name in builtin_sets():
        return False
    if name not in sets and len(sets) >= MAX_SETS:
        return False
    sets[name] = [dict(r) for r in tables["dance"]]
    save_tables()
    return True


def delete_set(name) -> bool:
    if not isinstance(name, str) or name not in sets:
        return False
    sets.pop(name)
    set_rows(tables["dance"], "dance")                # writes the file anew – or removes it when nothing of the owner's is left
    return True


def set_rows(new, mode: str = "dance") -> list:
    """A mode's table from a page: "reset" brings its built-in rows back, a list replaces the table. When every table
    is the built-in one again, the file goes."""
    if mode not in MODES:
        return []
    if new == "reset":
        tables[mode] = [dict(r) for r in DEFAULT_TABLES[mode]]
    elif isinstance(new, list):
        tables[mode] = clean_rows(new)
    else:
        return tables[mode]
    if tables == default_tables() and not sets:
        try:
            os.remove(MAP_FILE)
        except OSError:
            pass
    else:
        save_tables()
    return tables[mode]


def drop_source(src: str) -> bool:
    """#236: a source is gone for good (a taught move was deleted) – the rows that had it leave every table and every
    set of the owner's. Whether anything changed."""
    new_tables = {m: [r for r in rows if r["src"] != src] for m, rows in tables.items()}
    new_sets = {k: [r for r in rows if r["src"] != src] for k, rows in sets.items()}
    if new_tables == tables and new_sets == sets:
        return False
    sets.clear()
    sets.update(new_sets)
    tables.update(new_tables)
    set_rows(tables["dance"], "dance")                # writes the file anew
    return True


# #249: the switches of the cards "Direct interaction" and "Movement" of earlier versions → the row each one is now
OLD_SWITCHES = {"touch_paint": "paint", "touch_warp": "warp", "touch_impulse": "impulse", "touch_light": "light",
                "touch_content": "content"}


def adopt(old: dict) -> bool:
    """#249, once: a state saved before the modes (it has the movement switch "flowtrack" and no mode) hands its
    switches to the rows of the flowtrack and the dance table – what was ticked stays on, what was not stays off; "react
    to movement" together with "movement also moves the slow AI sliders" is the row "react". Done only while the file
    has no table per mode yet, so a later start never undoes the owner's rows."""
    global tables
    if not isinstance(old, dict) or "flowtrack" not in old or "move_mode" in old or is_current():
        return False
    tables = load_tables()                           # the dance table of #235, if there is one, with the new rows
    want = {row: old[k] is not False for k, row in OLD_SWITCHES.items() if isinstance(old.get(k), bool)}
    want["react"] = old.get("motion") is not False and old.get("motion_ai") is True
    for mode in ("flowtrack", "dance"):
        for r in tables[mode]:
            if r["id"] in want:
                r["on"] = want[r["id"]]
    save_tables()
    return True


def row_on(mode: str, dst: str) -> bool:
    """Whether a row of this mode's table that is switched on moves this target."""
    return any(r["on"] and r["dst"] == dst for r in tables.get(mode, ()))


def msg() -> dict:
    """The tables for the pages: every mode's (the stage, the panel), the dance table by its own name (#235), and the
    names of the movement sets (#251)."""
    return {"dance": {"map": tables["dance"], "tables": tables, "sets": list(all_sets()), "own_sets": list(sets)}}
