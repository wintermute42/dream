"""The dream's colour for the room (#212): one source, read by every room-light output (wled.py today; later lamps
that change only about once a second read the same). The stage samples what the audience sees tiny about a dozen
times a second (static/roomlight.js) and tells it over /ctl ({"led": {"rgb": [r, g, b]}}), a beat or a flash the moment
it comes ({"led": {"beat": 0…1}}, {"led": {"flash": 0…1}}; ctl.py, also on a trance of Dreamy Eyes).

Here that becomes, at any moment an output asks:
- colour(now): the picture's colour, smoothed and a little more colourful – calm, for slow lamps;
- lit(now, beat_on): the same with the beat's pulse and a flash on top – for LEDs that follow at 40 frames a second;
- master(now): the master fader as the light shows it (it glides like the stage's; a blackout is exactly 0);
- fresh(now): whether the stage tells its colour right now (closed or hidden: the outputs let their devices go).

The state moves with the time between two questions, so outputs that ask at different rates see the same light. An
output multiplies its colour with master() (and a strength of its own) last."""
import math
import time

COLOUR_TAU = 0.45                # seconds: how softly the colour follows the picture
MASTER_GLIDE = 0.12              # seconds from full to black – as the stage's master fader
BEAT_TAU, FLASH_TAU = 0.16, 0.35   # how fast a beat and a flash fade
BEAT_DEPTH = 0.45                # between the beats the light sinks this far; on the beat it is full
BEATING_FOR = 2.0                # seconds after the last beat the music still counts as beating
SATURATE = 1.5                   # an average colour is greyer than the picture: its colourfulness is raised this much
SILENT_AFTER = 3.0               # seconds without a colour from the stage: it counts as gone


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class Light:
    """The stage's colour, smoothed, with its beat and flash, and the master – moved on by the time asked for."""

    def __init__(self):
        self.target = None              # the latest colour of the stage (r, g, b 0–255), None: none yet
        self.at = -1e9                  # when it came (monotonic)
        self.t = None                   # the time the state below was moved on to
        self.smooth = None              # the smoothed colour
        self.beat, self.beat_at = 0.0, -1e9     # the latest beat: how strong, when (it fades with the time since)
        self.beating = 0.0              # 0…1: the music has a beat right now (glides, so the pulse comes and goes softly)
        self.beat_on = True
        self.flash, self.flash_at = 0.0, -1e9
        self.glide = None               # the master as the light shows it
        self.master_to = 1.0

    def take(self, msg, now: float) -> None:
        """A word of the stage: {"rgb": [r, g, b]}, {"beat": 0…1}, {"flash": 0…1}. Anything odd is not taken."""
        if not isinstance(msg, dict):
            return
        self._move(now)
        rgb = msg.get("rgb")
        if isinstance(rgb, list) and len(rgb) == 3 and all(_num(c) for c in rgb):
            self.target = tuple(min(255.0, max(0.0, float(c))) for c in rgb)
            self.at = now
        if _num(msg.get("beat")) and msg["beat"] > 0:
            self.beat, self.beat_at = max(self.pulse_of(now), min(1.0, float(msg["beat"]))), now
        if _num(msg.get("flash")) and msg["flash"] > 0:
            self.flash, self.flash_at = max(self.flash_of(now), min(1.0, float(msg["flash"]))), now

    def pulse_of(self, now: float) -> float:
        """What is left of the latest beat (0…1)."""
        return self.beat * math.exp(-max(0.0, now - self.beat_at) / BEAT_TAU)

    def flash_of(self, now: float) -> float:
        return self.flash * math.exp(-max(0.0, now - self.flash_at) / FLASH_TAU)

    def fresh(self, now: float) -> bool:
        return self.target is not None and now - self.at < SILENT_AFTER

    def _move(self, now: float) -> None:
        """Moves the state on to now – the same however often it is asked (a smoothing step of 1 s is 40 of 1/40 s)."""
        dt = 0.0 if self.t is None else max(now - self.t, 0.0)
        self.t = now if self.t is None else max(self.t, now)
        if self.target is not None:
            self.smooth = self.target if self.smooth is None else tuple(
                c + (t - c) * (1 - math.exp(-dt / COLOUR_TAU)) for c, t in zip(self.smooth, self.target))
        want = 1.0 if self.beat_on and now - self.beat_at < BEATING_FOR else 0.0
        self.beating += max(-dt / 0.5, min(dt / 0.5, want - self.beating))
        if self.glide is not None:
            self.glide += max(-dt / MASTER_GLIDE, min(dt / MASTER_GLIDE, self.master_to - self.glide))

    def colour(self, now: float) -> tuple:
        """The picture's colour, smoothed and a little more colourful (r, g, b floats 0–255) – black before the first."""
        self._move(now)
        if self.smooth is None:
            return (0.0, 0.0, 0.0)
        m = sum(self.smooth) / 3
        return tuple(min(255.0, max(0.0, m + (c - m) * SATURATE)) for c in self.smooth)

    def lit(self, now: float, beat_on: bool = True) -> tuple:
        """colour() with the beat's pulse (if beat_on: full on the beat, lower between the beats) and a flash towards
        white – for an output that follows quickly."""
        self.beat_on = beat_on
        base = self.colour(now)
        pulse = 1 - BEAT_DEPTH * self.beating * (1 - self.pulse_of(now))
        f = min(1.0, self.flash_of(now)) * 0.8
        return tuple((c + (255.0 - c) * f) * pulse for c in base)

    def master(self, now: float, to: float) -> float:
        """The master fader (to: the setting, 0–1) as the light shows it: gliding like the stage's, a blackout is 0."""
        self.master_to = max(0.0, min(1.0, float(to)))
        if self.glide is None:
            self.glide = self.master_to
        self._move(now)
        return self.glide


light = Light()


def take(msg) -> None:
    """The stage's word over /ctl (ctl.py)."""
    light.take(msg, time.monotonic())


def flash(v: float = 1.0) -> None:
    """A trance of Dreamy Eyes (ctl.py): the light flashes."""
    light.take({"flash": v}, time.monotonic())
