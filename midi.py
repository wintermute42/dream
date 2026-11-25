"""MIDI controllers (faders, knobs, buttons) steer Dream: read on this Mac with mido + python-rtmidi.

Mappings live in ~/.config/dream/midi.json (never in the repository):
  {"c1:cc7": {"target": "strength"}, "c1:cc64": {"action": "next"}, "c1:n36": {"action": "blackout"}}
A key is the MIDI channel (1–16) plus a controller ("ccN") or a note ("nN"). Absolute controllers (0–127) are scaled
to the target's range; relative (endless) knobs that send 1–63 up / 65–127 down are recognised by their values and
nudge the current value instead.
"""
import json
import os
import threading
import time

import paths
import settings
from playlists import FX

MAP_FILE = os.path.join(paths.config_dir(), "midi.json")

# what a controller can move: state key → (min, max) – the settings marked as targets in the settings table (#189)
TARGETS = settings.TARGETS
# a button can switch one of the 60 fps effects (playlists.FX) on or off ("fx_<name>"), all off or pick a fitting set
# what a button (note, or a controller jumping to 127) does
ACTIONS = (("pause", "next", "restart", "reseed", "blackout", "tap", "pattern", "world", "fx_off", "fx_new")
           + tuple("fx_" + e for e in FX) + ("dance_good", "dance_bad")   # #243: feedback for the dance lab (a foot pedal)
           + ("clutch", "dance_set"))                     # #251: the dance's clutch in or out, the next movement set


def key_of(msg) -> str | None:
    if msg.type == "control_change":
        return f"c{msg.channel + 1}:cc{msg.control}"
    if msg.type in ("note_on", "note_off"):
        return f"c{msg.channel + 1}:n{msg.note}"
    return None


def load_map() -> dict:
    try:
        with open(MAP_FILE) as f:
            data = json.load(f)
        return {k: v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}
    except (FileNotFoundError, ValueError, OSError):
        return {}


def save_map(mapping: dict) -> None:
    os.makedirs(os.path.dirname(MAP_FILE), exist_ok=True)
    tmp = MAP_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=1)
    os.replace(tmp, MAP_FILE)


def scale(value: int, target: str) -> float:
    lo, hi = TARGETS[target]
    return round(lo + (hi - lo) * max(0, min(127, value)) / 127, 4)


class RelativeGuess:
    """Endless knobs send small steps around 1 (up) and 127/65 (down); faders and pots sweep all values.
    After a few messages per controller the guess settles. A control that ever sent a value from the middle is a
    fader/pot for good: pushed against its end it only sends 125–127 (or 0–3), which looks like an endless knob
    turning – taken as such, the value ran off towards the other end."""

    def __init__(self):
        self.seen: dict = {}
        self.absolute: set = set()

    STEPS = (1, 2, 3, 125, 126, 127, 63, 65, 66, 67)

    def is_relative(self, key: str, value: int):
        """True (endless knob), False (fader/pot) or None (not sure yet: wait instead of jumping)."""
        if key in self.absolute:
            return False
        vals = self.seen.setdefault(key, [])
        vals.append(value)
        del vals[:-12]
        if any(v not in self.STEPS for v in vals) or len(set(vals)) > 4:
            self.absolute.add(key)                      # sticky: never guessed relative again
            return False
        return True if len(vals) >= 4 else None


def nudge(current: float, value: int, target: str) -> float:
    """Relative step: 1..63 up, 65..127 down (two's complement style), 1/100 of the range per tick."""
    lo, hi = TARGETS[target]
    step = value if value < 64 else value - 128
    return round(max(lo, min(hi, current + step * (hi - lo) / 100)), 4)


class Listener:
    """Opens every MIDI input (also ones plugged in later) and hands messages to `on_message(key, msg)`."""

    def __init__(self, on_message, on_ports):
        self.on_message, self.on_ports = on_message, on_ports
        self.ports: dict = {}
        self.error = ""
        self._stop = threading.Event()

    def start(self):
        threading.Thread(target=self._run, daemon=True, name="midi").start()

    def stop(self):
        self._stop.set()

    def _run(self):
        try:
            import mido
            mido.set_backend("mido.backends.rtmidi")
        except Exception as e:                       # not on macOS, or the packages are missing
            self.error = ("MIDI not available ({e})", {"e": e.__class__.__name__})   # #132: translated where it is shown
            self.on_ports([])
            return
        while not self._stop.is_set():
            try:
                names = set(mido.get_input_names())
            except Exception:
                names = set()
            for gone in [n for n in self.ports if n not in names]:
                try:
                    self.ports.pop(gone).close()
                except Exception:
                    pass
            for new in [n for n in names if n not in self.ports and not n.startswith("Dream")]:
                try:
                    self.ports[new] = mido.open_input(new, callback=self._callback)
                except Exception:
                    pass
            self.on_ports(sorted(self.ports))
            self._stop.wait(3)                         # hot-plug: look for new controllers every 3 s

    def _callback(self, msg):
        k = key_of(msg)
        if k:
            self.on_message(k, msg)


class Throttle:
    """Collects controller values and lets the server apply them at most ~30 times a second."""

    def __init__(self):
        self.lock = threading.Lock()
        self.pending: dict = {}
        self.actions: list = []
        self.learned = None
        self.last = ("", 0.0)
        self.pressed: set = set()

    def put(self, target, value):
        with self.lock:
            self.pending[target] = value

    def act(self, action):
        with self.lock:
            self.actions.append(action)

    def take(self):
        with self.lock:
            p, a, l = self.pending, self.actions, self.learned
            self.pending, self.actions, self.learned = {}, [], None
        return p, a, l


def handle(mapping: dict, thr: Throttle, guess: RelativeGuess, learn: dict, state: dict, key: str, msg) -> None:
    """One incoming message: learn it, move a target, or fire an action."""
    is_note = msg.type in ("note_on", "note_off")
    value = getattr(msg, "velocity", 0) if is_note else msg.value
    if msg.type == "note_off":
        value = 0
    thr.last = (key, time.time())
    if learn.get("target"):                            # MIDI learn: the next touched control gets the target
        if is_note and value == 0:
            return
        entry = {"action": learn["target"]} if learn["target"] in ACTIONS else {"target": learn["target"]}
        mapping[key] = entry
        save_map(mapping)
        thr.learned = {"key": key, **entry}
        learn.clear()
        return
    m = mapping.get(key)
    if not m:
        return
    if "action" in m:
        if value > 63 and key not in thr.pressed:       # press (a controller jumping up counts as press)
            thr.pressed.add(key)
            thr.act(m["action"])
        elif value <= 63:
            thr.pressed.discard(key)
        return
    target = m.get("target")
    if target not in TARGETS:
        return
    rel = None if is_note else guess.is_relative(key, value)
    if rel is None and not is_note:
        return                                         # first ticks of a knob that may be endless: don't jump
    if rel:
        current = thr.pending.get(target, state.get(target, TARGETS[target][0]))
        thr.put(target, nudge(float(current), value, target))
    else:
        thr.put(target, scale(value, target))
