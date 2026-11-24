"""The movement engine's part in Dream itself (#249): the modes, and the register of the movement sources that do not
live in the stage.

Movement has one engine: every source feeds one feature stream (static/dance.js), every effect runs through one
mapping table (dance.py), and a mode – off, mood, flowtrack, dance; one at a time – is only a preset: which kinds of
sources it listens to, whether it needs the Mac's camera, and its table. The stage runs the engine
(static/movement.js: it mixes the sources, fades from one mode's table to the next and opens the camera only for a
mode that needs it); here is what the stage cannot know by itself: who else sends movement.

The kinds of sources (settings.MOVE_SOURCES): "camera" (the Mac's camera in the stage: hands, pose and fingers, fire
and LEDs, LED markers), "eyes" (Dreamy Eyes: the energy of what their front camera sees, worked out on the phone –
only that number comes here, never a picture), "phone" (a phone that lends its motion sensors: Dream Control) and
"band" (a wristband or glove over OSC). Dream windows are no source. Each kind can be switched off (the setting
"move_off"). Nothing here keeps or sees a picture, and nothing here loads PyTorch."""
import math
import time

import settings

# what a mode listens to and whether it opens the Mac's camera by itself; its table is `dance.tables[mode]`.
# The mood takes the room – Dreamy Eyes and phones – and the Mac's camera only when asked ("move_cam").
MODES = {
    "off": {"sources": (), "camera": False},
    "mood": {"sources": ("eyes", "phone", "band", "camera"), "camera": False},
    "flowtrack": {"sources": ("camera", "band", "phone"), "camera": True},
    "dance": {"sources": ("camera", "band", "phone"), "camera": True},
}
assert tuple(MODES) == settings.MOVE_MODES and all(set(m["sources"]) <= set(settings.MOVE_SOURCES) for m in MODES.values())
FRESH = 1.5                                         # seconds a source counts as active after its last value
GONE = 20.0                                         # … and stays in the list, as silent
MAX_SOURCES = 24


def mode_of(state: dict) -> str:
    return state["move_mode"] if state.get("move_mode") in MODES else "off"


def off_kinds(state: dict) -> set:
    return set(str(state.get("move_off") or "").split("+")) & set(settings.MOVE_SOURCES)


def uses(state: dict, kind: str) -> bool:
    """Whether the mode in use listens to this kind of source right now (it is in the mode's preset, not switched
    off, and – the Mac's camera in the mood – asked for)."""
    mode = mode_of(state)
    if kind not in MODES[mode]["sources"] or kind in off_kinds(state):
        return False
    return kind != "camera" or MODES[mode]["camera"] or bool(state.get("move_cam"))


def camera_on(state: dict) -> bool:
    """The Mac's camera runs only for a mode that needs it."""
    return uses(state, "camera")


def _unit(v) -> float | None:
    """A number 0 … 1 as a device sent it, or None (anything else is not taken)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not -1e300 < v < 1e300 or not math.isfinite(v):
        return None
    return min(1.0, max(0.0, float(v)))


class Sources:
    """The register: every source with its name, its kind and its state – active, values a second, confidence – and
    the energy it reports. The stage adds its own camera to the list it gets."""

    def __init__(self):
        self.items: dict = {}                       # id → {kind, name, at, energy, conf, n, rate, since}

    def report(self, id_: str, kind: str, name: str, energy, conf=1.0, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        e, c = _unit(energy), _unit(conf)
        if kind not in settings.MOVE_SOURCES or e is None or c is None:
            return False
        it = self.items.get(id_)
        if it is None:
            self.sweep(now)
            if len(self.items) >= MAX_SOURCES:
                return False
            it = self.items[id_] = {"kind": kind, "name": str(name)[:40], "n": 0, "rate": 0.0, "since": now}
        it.update(at=now, energy=e, conf=c, n=it["n"] + 1)
        if now - it["since"] >= 1.0:                # values a second, counted over the last second
            it.update(rate=it["n"] / (now - it["since"]), n=0, since=now)
        return True

    def drop(self, id_: str) -> None:
        self.items.pop(id_, None)

    def sweep(self, now: float) -> None:
        for k in [k for k, it in self.items.items() if now - it["at"] > GONE]:
            self.items.pop(k)

    def listing(self, state: dict, now: float | None = None) -> list:
        """What the pages show and the stage mixes: per source its kind, name, whether it is switched on ("on"),
        whether the mode in use listens to it ("used"), whether values come ("active"), how many a second, how sure,
        and the energy. A silent source says so – it never keeps its last energy."""
        now = time.monotonic() if now is None else now
        self.sweep(now)
        off, out = off_kinds(state), []
        for id_, it in sorted(self.items.items()):
            active = now - it["at"] <= FRESH
            out.append({"id": id_, "kind": it["kind"], "name": it["name"], "on": it["kind"] not in off,
                        "used": uses(state, it["kind"]), "active": active,
                        "rate": round(it["rate"] if active else 0.0, 1), "conf": round(it["conf"] if active else 0.0, 2),
                        "energy": round(it["energy"] if active else 0.0, 3)})
        return out


sources = Sources()


def room_energy(listing: list) -> tuple:
    """The energy of the room: the mean of every active source the mode listens to, weighted by how sure each one is –
    so one lively device does not rule a quiet room. (energy, confidence); the stage works it out the same way
    (static/movement.js: `room`) with its camera among them."""
    pairs = [(s["energy"], s["conf"]) for s in listing if s["active"] and s["used"] and s["conf"] > 0]
    weight = sum(c for _, c in pairs)
    if weight <= 0:
        return 0.0, 0.0
    sure = 1.0
    for _, c in pairs:
        sure *= 1 - c
    return sum(e * c for e, c in pairs) / weight, 1 - sure


def msg(state: dict, now: float | None = None) -> dict:
    return {"move": {"sources": sources.listing(state, now)}}
