"""Motion sensors on the body (a phone on the forearm, later a wristband or a glove) steer Dream over OSC.

Every OSC message with numbers becomes channels "<address>:<index>" (e.g. "/gyroscope:2"), whatever the sender
(Sensors2OSC, ZIG SIM, our own wristband). Each channel is smoothed and normalised to 0..1 by its own recent range,
so nothing needs calibrating. Derived channels:
  "swing"   – energy of the movement (gyroscope magnitude, normalised)
  "impulse" – a whip/strike: a peak of the acceleration magnitude above its running level, with a dead time
Mappings in ~/.config/dream/sensors.json (never in the repository):
  {"/orientation:1": {"target": "zoom", "invert": false, "lo": -20.5, "hi": 31.0}, "impulse": {"action": "flash"},
   "sensitivity": 1.0}
"lo"/"hi" (#240): the range the channel moved through while it was learned – that movement is the whole slider, so a
resting sensor stays where it is instead of its shrinking auto-range blowing its noise up to the full slider.
"""
import json
import math
import os
import time

import paths

MAP_FILE = os.path.join(paths.config_dir(), "sensors.json")
IMPULSE_ACTIONS = ("flash", "jolt", "reseed", "next", "blackout")
# #240: what a channel says about the device. A position (how it is turned: orientation, or the accelerometer with
# gravity, which shows the tilt) holds a slider where it is put; a rate (rotation rate, acceleration without gravity)
# is noise around zero with spikes – learned onto a slider it makes the slider jump. Learning takes a rate only when
# no position moved clearly, and an angle before the accelerometer, which every strike shakes.
RATE_HINTS = ("gyro", "rotation_rate", "rotationrate", "linear")
ANGLE_HINTS = ("orient", "euler", "attitude")
STEER_SMOOTH = 0.3          # how quickly a steered value follows its channel, per sensor tick (~30 a second)


def is_rate(key: str) -> bool:
    return any(h in key.lower() for h in RATE_HINTS)


def is_angle(key: str) -> bool:
    return any(h in key.lower() for h in ANGLE_HINTS)


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
        self.rlo, self.rhi = v, v           # #240: the movement of the last moment (~0.5 s) – learning compares with it
        self.norm = 0.5

    def update(self, v: float, alpha: float = 0.45) -> float:
        self.v += (v - self.v) * alpha
        self.rlo = min(self.v, self.rlo + (self.v - self.rlo) * 0.08)
        self.rhi = max(self.v, self.rhi + (self.v - self.rhi) * 0.08)
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
        self.raw: dict = {}                 # #240: an angle's last number, to unwrap it (359° → 1° is 2°, not -358°)
        self.out: dict = {}                 # #240: the steered values, smoothed

    # ---------- incoming ----------
    def on_osc(self, address: str, args, source: str = "", now: float | None = None):
        now = time.time() if now is None else now
        # finite numbers only; #208: compared, not math.isfinite – that raises for an integer too big for a float
        nums = [float(a) for a in args if isinstance(a, (int, float)) and not isinstance(a, bool) and -1e300 < a < 1e300]
        if not nums:
            return
        self.source = source
        self.count += 1
        if now - self.rate_t >= 1:
            self.rate, self.count, self.rate_t = self.count / (now - self.rate_t), 0, now
        low = address.lower()
        angle = is_angle(address)
        for i, v in enumerate(nums[:4]):
            key = f"{address}:{i}"
            if angle:                        # a turn past 360° (or ±180°) goes on, it does not jump back
                last = self.raw.get(key)
                if last is not None:
                    v -= 360.0 * round((v - last) / 360.0)
                self.raw[key] = v
            c = self.ch.get(key)
            if c is None:
                self.ch[key] = Channel(v)
            else:
                c.update(v)
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
        # #240: how much each channel moved just before – a device in the hand that was swung or turned a while ago
        # (a strike tried out, the phone picked up) must not make its learning movement look small. A floor of its
        # known range keeps a channel that rested completely from winning on noise.
        base = {k: max(c.rhi - c.rlo, 0.02 * (c.hi - c.lo), 1e-6) for k, c in self.ch.items() if k != "swing"}
        self.learn = {"target": target, "until": now + 2.5, "seen": {}, "base": base}

    def _learning(self, now: float):
        seen = self.learn["seen"]
        for k, c in self.ch.items():
            if k == "swing":
                continue
            lo, hi, path, last = seen.get(k, (c.v, c.v, 0.0, c.v))
            seen[k] = (min(lo, c.v), max(hi, c.v), path + abs(c.v - last), c.v)
        if now < self.learn["until"]:
            return

        base = self.learn["base"]

        def moved(k):
            lo, hi = seen[k][:2]
            return (hi - lo) / base.get(k, max(hi - lo, 1e-6))

        def steady(k):                                   # #240: turned through its range, not shaken to and fro
            lo, hi, path = seen[k][:3]
            return (hi - lo) / path >= 0.1 if path > 0 else False
        clear = [k for k in seen if moved(k) > 1.5]      # clearly more movement than before
        # #240: a steady position first – an angle before the accelerometer –, then any position (see RATE_HINTS), then
        # the one that moved most
        best = max(clear, key=lambda k: (steady(k) and not is_rate(k), is_angle(k), not is_rate(k), moved(k)), default=None)
        target = self.learn["target"]
        self.learn = {}
        if best:
            lo, hi = seen[best][:2]
            pad = (hi - lo) * 0.1                        # the ends of the shown movement reach the ends of the slider
            for k in [k for k, m in self.mapping.items() if isinstance(m, dict) and m.get("target") == target]:
                self.mapping.pop(k)                      # #240: one channel per target – two would pull it to and fro
            self.mapping[best] = {"target": target, "invert": False, "lo": round(lo + pad, 4), "hi": round(hi - pad, 4)}
            self.out.pop(target, None)
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
            c = self.ch[key]
            lo, hi = m.get("lo"), m.get("hi")
            if isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and hi - lo > 1e-6:
                n = min(1.0, max(0.0, (c.v - lo) / (hi - lo)))   # #240: the range it was learned with
            else:
                n = c.norm                                   # mappings of earlier versions: the auto-range
            if m.get("invert"):
                n = 1 - n
            t = m["target"]
            prev = self.out.get(t)
            n = n if prev is None else prev + (n - prev) * STEER_SMOOTH
            self.out[t] = n
            tlo, thi = targets[t]
            out[t] = round(tlo + (thi - tlo) * n, 4)
        return out

    def live(self) -> dict:
        busiest = sorted((k for k in self.ch if k != "swing"), key=lambda k: -(self.ch[k].hi - self.ch[k].lo))[:6]
        return {"rate": round(self.rate), "source": self.source,
                "swing": round(self.ch["swing"].norm, 2) if "swing" in self.ch else None,
                "channels": {k: round(self.ch[k].norm, 2) for k in busiest}}
