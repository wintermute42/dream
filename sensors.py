"""Motion sensors on the body (a phone on the forearm, later a wristband or a glove) steer Dream over OSC.

Every OSC message with numbers becomes channels "<address>:<index>" (e.g. "/gyroscope:2"), whatever the sender
(Sensors2OSC, ZIG SIM, our own wristband). Each channel is smoothed and normalised to 0..1 by its own recent range,
so nothing needs calibrating. Derived channels:
  "swing"   – energy of the movement (gyroscope magnitude, normalised)
  "impulse" – a whip/strike: a peak of the acceleration magnitude above its running level, with a dead time
Mappings in ~/.config/dream/sensors.json (never in the repository):
  {"/orientation:1": {"target": "zoom", "invert": false}, "impulse": {"action": "flash"}, "sensitivity": 1.0}
"""
import json
import math
import os
import time

import paths

MAP_FILE = os.path.join(paths.config_dir(), "sensors.json")
IMPULSE_ACTIONS = ("flash", "jolt", "reseed", "next", "blackout")


def load_map() -> dict:
    try:
        with open(MAP_FILE) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, ValueError, OSError):
        return {}


def save_map(mapping: dict) -> None:
    os.makedirs(os.path.dirname(MAP_FILE), exist_ok=True)
    tmp = MAP_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=1)
    os.replace(tmp, MAP_FILE)


class Channel:
    """Smoothing (exponential, fast enough for whips) and an auto-range that slowly forgets old extremes."""

    def __init__(self, v: float):
        self.v = v
        self.lo, self.hi = v, v
        self.norm = 0.5

    def update(self, v: float, alpha: float = 0.45) -> float:
        self.v += (v - self.v) * alpha
        span = max(self.hi - self.lo, 1e-6)
        self.lo = min(self.v, self.lo + span * 0.0015)       # the range shrinks back slowly (~10 s)
        self.hi = max(self.v, self.hi - span * 0.0015)
        span = self.hi - self.lo
        self.norm = (self.v - self.lo) / span if span > 1e-4 else 0.5
        return self.norm


class Sensors:
    def __init__(self):
        self.ch: dict = {}
        self.mapping = load_map()
        self.sensitivity = float(self.mapping.get("sensitivity", 1.0) or 1.0)
        self.learn: dict = {}               # {"target", "until", "base": {channel: (min, max)}}
        self.count, self.rate, self.rate_t = 0, 0.0, time.time()
        self.source = ""
        self.acc_level = 0.0
        self.impulse_at = 0.0
        self.events: list = []              # ("learned", key, target) | ("impulse", strength)

    # ---------- incoming ----------
    def on_osc(self, address: str, args, source: str = "", now: float | None = None):
        now = time.time() if now is None else now
        nums = [float(a) for a in args if isinstance(a, (int, float)) and not isinstance(a, bool) and math.isfinite(a)]
        if not nums:
            return
        self.source = source
        self.count += 1
        if now - self.rate_t >= 1:
            self.rate, self.count, self.rate_t = self.count / (now - self.rate_t), 0, now
        for i, v in enumerate(nums[:4]):
            key = f"{address}:{i}"
            c = self.ch.get(key)
            if c is None:
                self.ch[key] = Channel(v)
            else:
                c.update(v)
        low = address.lower()
        mag = math.sqrt(sum(v * v for v in nums[:3]))
        if "gyro" in low or "rotation_rate" in low or "rotationrate" in low:
            c = self.ch.setdefault("swing", Channel(0.0))
            c.update(mag, alpha=0.3)
        if "accel" in low or "linear" in low:
            self._impulse(mag, now, gravity=("linear" not in low))
        if self.learn:
            self._learning(now)

    def _impulse(self, mag: float, now: float, gravity: bool):
        if gravity:                          # raw accelerometer: take away the ~9.81 of gravity
            mag = abs(mag - 9.81)
        self.acc_level += (mag - self.acc_level) * 0.02    # running level of the arm's movement
        threshold = max(6.0, self.acc_level * 3.0) / max(self.sensitivity, 0.1)
        if mag > threshold and now - self.impulse_at > 0.25:   # 250 ms dead time: one whip, one impulse
            self.impulse_at = now
            self.events.append(("impulse", min(1.0, mag / (threshold * 2))))

    # ---------- learning: the channel that moves most while the target is chosen ----------
    def start_learning(self, target: str, now: float | None = None):
        now = time.time() if now is None else now
        # how much each channel moved before: the learned one is the one that moves far MORE now than before
        base = {k: max(c.hi - c.lo, 1e-6) for k, c in self.ch.items() if k != "swing"}
        self.learn = {"target": target, "until": now + 2.5, "seen": {}, "base": base}

    def _learning(self, now: float):
        seen = self.learn["seen"]
        for k, c in self.ch.items():
            if k == "swing":
                continue
            lo, hi = seen.get(k, (c.v, c.v))
            seen[k] = (min(lo, c.v), max(hi, c.v))
        if now < self.learn["until"]:
            return

        base = self.learn["base"]

        def moved(k):
            lo, hi = seen[k]
            return (hi - lo) / base.get(k, max(hi - lo, 1e-6))
        best = max(seen, key=moved, default=None)
        target = self.learn["target"]
        self.learn = {}
        if best and moved(best) > 1.5:                  # clearly more movement than before
            self.mapping[best] = {"target": target, "invert": False}
            save_map(self.mapping)
            self.events.append(("learned", best, target))
        else:
            self.events.append(("learned", "", target))

    # ---------- what the mapped channels ask for ----------
    def values(self, targets: dict) -> dict:
        out = {}
        for key, m in self.mapping.items():
            if not isinstance(m, dict) or m.get("target") not in targets or key not in self.ch:
                continue
            n = self.ch[key].norm
            if m.get("invert"):
                n = 1 - n
            lo, hi = targets[m["target"]]
            out[m["target"]] = round(lo + (hi - lo) * n, 4)
        return out

    def live(self) -> dict:
        busiest = sorted((k for k in self.ch if k != "swing"), key=lambda k: -(self.ch[k].hi - self.ch[k].lo))[:6]
        return {"rate": round(self.rate), "source": self.source,
                "swing": round(self.ch["swing"].norm, 2) if "swing" in self.ch else None,
                "channels": {k: round(self.ch[k].norm, 2) for k in busiest}}
