"""Dream's settings – one table (#189): every setting of the shared state with its default, its type, the range of a
number or the choices of a text, whether a guest (Dream Remote) may change it, and whether a MIDI controller or a
motion sensor can move it, and how strongly it shapes the picture (#216). A new setting is one entry here; the defaults,
the ranges, the guests' keys, the MIDI targets, what "Reset" brings home and what the pages draw on a slider are read
from this table (`DEFAULT_STATE`, `RANGES`, `GUEST_KEYS`, `TARGETS`, `RESET`, `page_schema`), never written down again.

The type of a setting is the type of its default: a switch (bool), a number (int or float, always with a range) or a
text. Nothing here loads PyTorch or reads the environment."""
import ipaddress
import math
import re
from dataclasses import dataclass

import models
import playlists


@dataclass(frozen=True)
class Setting:
    default: object
    lo: float | None = None           # a number's range (#175): a value outside is clamped
    hi: float | None = None
    choices: tuple | None = None      # a text with fixed values: anything else is refused
    guest: object = False             # #148: may a guest change it – True, False, or the set of values a guest may set
    target: bool = False              # a MIDI controller or a motion sensor can move it (midi.TARGETS)
    clean: object = None              # a text's own rule: str -> str (old names, known effects, an id)
    weight: float = 0.0               # #216: how strongly a number shapes the picture (0 = not at all … 1); "Reset"
                                      # brings every number with a weight home, the pages colour its slider by it
    needs: str | None = None          # #216: the setting it only acts with (a switch that is on, a choice not "off")
    steps: tuple | None = None        # #247: a number with fixed values: anything else becomes the nearest of them

    @property
    def bipolar(self) -> bool:
        """#216: a number with zero inside its range: its slider fills from the zero mark."""
        return self.number and self.lo < 0 < self.hi

    @property
    def number(self) -> bool:
        return isinstance(self.default, (int, float)) and not isinstance(self.default, bool)

    @property
    def kind(self) -> str:
        d = self.default
        return "bool" if isinstance(d, bool) else "int" if isinstance(d, int) else "float" if isinstance(d, float) else "text"


def num(default, lo, hi, *, guest=False, target=False, weight=0.0, needs=None) -> Setting:
    return Setting(default, lo=lo, hi=hi, guest=guest, target=target, weight=weight, needs=needs)


def stepped(default, steps) -> Setting:
    """#247: a number that only has these values (the pages offer them as a list)."""
    return Setting(default, lo=min(steps), hi=max(steps), steps=tuple(sorted(steps)))


def flag(default: bool, *, guest=False) -> Setting:
    return Setting(default, guest=guest)


def text(default: str = "", *, choices=None, guest=False, clean=None) -> Setting:
    return Setting(default, choices=tuple(choices) if choices else None, guest=guest, clean=clean)


# #247: the picture sizes (the height in pixels; 16:9 widens it). The pages offer exactly these (the stage's and Dream
# Control's list, DreamCommon.SIZES) and the stage builds its pictures from the list's value – a size that is not in it
# left the stage without a picture to send. So any other number becomes the nearest of these, here, for every way in.
SIZES = (384, 512, 768, 1024)


def _style(v: str) -> str:
    """#123: a known style model or none (#133: old German keys too)."""
    v = playlists.OLD_STYLES.get(v, v)
    return v if v in playlists.PICTURE_STYLES else ""


def _style_ref(v: str) -> str:
    """#123: a reference picture's id or none."""
    return v if re.fullmatch(r"[0-9a-f]{12}", v) else ""


def _fx(v: str) -> str:
    """Only known effects, each once."""
    return "+".join(dict.fromkeys(e for e in v.split("+") if e in playlists.FX))


# #221: the style worlds Dreamy Eyes and the dream windows can be drawn in. Each is one file `static/world-<name>.js`
# that registers itself with the style layer (static/dreamstyle.js); the first is today's look. A test compares.
WORLDS = ("classic", "deepsea", "ink", "etching", "aurora")


# #249: movement is one engine with one mode at a time – a mode is a preset of the mapping table (dance.py: which
# sources it listens to, which targets it moves, at which thresholds). The kinds of sources a mode can listen to:
# the Mac's camera, Dreamy Eyes (their front camera – the energy is worked out on the phone), a phone that lends its
# motion (Dream Control), and a wristband or glove over OSC. Dream windows are no source.
MOVE_MODES = ("off", "mood", "flowtrack", "dance")
MOVE_SOURCES = ("camera", "eyes", "phone", "band")


# #251, #265: the name of a movement set – a short plain name: letters, digits, spaces and . + - – ("Flowing – mine")
SET_NAME = re.compile(r"[^\W_][\w .+\-–]{0,31}")


def _set_name(v: str) -> str:
    return v if SET_NAME.fullmatch(v) else ""


def _sources(v: str) -> str:
    """Only known kinds of movement sources, each once."""
    return "+".join(dict.fromkeys(k for k in v.split("+") if k in MOVE_SOURCES))


# #212: the address of the room light's WLED device – an IPv4 address or a host name (wled-room.local), nothing else:
# no port, no scheme, never half an address (a half-typed "192.168.1" would be read as another device)
HOST_NAME = re.compile(r"(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*")


def _host(v: str) -> str:
    v = v.strip().rstrip(".").lower()
    if re.fullmatch(r"[\d.]+", v):
        try:
            return str(ipaddress.IPv4Address(v))
        except ValueError:
            return ""
    return v if HOST_NAME.fullmatch(v) else ""


# #272: the Hue lamps and rooms that dream along – "l:<id>" a lamp, "g:<id>" a room or zone of the bridge (its ids are
# UUIDs), joined by "+"; anything else is dropped
HUE_ITEM = re.compile(r"[lg]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _hue_items(v: str) -> str:
    return "+".join(list(dict.fromkeys(k for k in v.lower().split("+") if HUE_ITEM.fullmatch(k)))[:50])


# #235: the colours an LED marker on a hand can have – never red, orange or yellow: those are fire
MARKERS = ("cyan", "magenta", "green", "blue")


def world_next(name: str) -> str:
    """#224: the world after this one in the list, round and round (the MIDI button, the drift)."""
    return WORLDS[(WORLDS.index(name) + 1) % len(WORLDS)] if name in WORLDS else WORLDS[0]


# #148, owner's decision (2026-11-18) on what a guest may change: painting, touching, directness, impulses, movement
# reaction, the pose and the music automatic/drop are the performer's – not a guest's; nor are "New" (the dream starts
# anew) and the QR on the stage … and (same day) neither removing the owner's picture or video, the rest of the
# movement card, nor the playlist. Everything without guest=True needs Dream Control or this Mac; enforced in the
# server (the /ctl filter), the remote page only hides what a guest cannot use.
# The ranges are the sliders' ranges (#175): NaN or Inf is refused, so nobody can poison the saved state.
SETTINGS: dict[str, Setting] = {
    "prompt": text("psychedelic kaleidoscope of glowing fractal flowers, vivid neon colors, intricate, dreamy", guest=True),
    # the Mac's camera (cam, flow) only on Control's or the stage's word
    "mode": text("dream", choices=("dream", "cam", "img", "vid", "flow"), guest=frozenset({"dream", "img", "vid"})),
    "backend": text("local", choices=("local", "cloud")),
    "cloud_bridge": flag(True),                                 # #238: while the cloud GPU sends no pictures, the Mac paints
    "model": text("sd-turbo", choices=models.MODELS),
    "running": flag(True),
    "strength": num(0.45, 0.0, 0.95, guest=True, target=True, weight=1.0),
    "mix": num(0.35, 0.0, 0.9, guest=True, target=True, weight=0.6),
    "zoom": num(0.008, -0.04, 0.06, guest=True, target=True, weight=1.0),
    "rot": num(0.2, -3.0, 3.0, guest=True, target=True, weight=1.0),
    "hue": num(2.0, 0.0, 20.0, guest=True, target=True, weight=0.8),
    "sens": num(1.0, 0.0, 2.0, guest=True, target=True, weight=0.5, needs="music"),
    "quality": num(2, 1, 4),
    "size": stepped(512, SIZES),
    "seed": num(1, 0, 2**31 - 1, guest=True),
    "music": text("off", choices=("off", "mic", "file")),
    "rewrite": flag(True),
    "playlist": text("", clean=playlists.new_name),             # installation: prompt playlist (#133: old names too)
    "interval": num(45, 5, 3600),
    "shuffle": flag(False),
    # #249: the movement mode (one at a time), the kinds of sources switched off ("eyes+band"), and whether the mood
    # also takes the Mac's camera (flowtrack and dance always need it; the mood runs without)
    "move_mode": text("off", choices=MOVE_MODES),
    "move_off": text("", clean=_sources),
    "move_cam": flag(False),
    "motion_sens": num(1.0, 0.0, 3.0, target=True, weight=0.4, needs="move_mode"),   # how strongly movement steers
    "syphon": flag(False),                                      # publish the stage picture as Syphon source "Dream"
    # #212: the room light – a WLED device lights its chain in the colour of the dream (wled.py): on/off, the device,
    # how bright (a MIDI fader can move it; the master and its blackout act on top) and whether it pulses on the beat
    "wled": flag(False),
    "wled_host": text("", clean=_host),
    "wled_amt": num(1.0, 0.0, 1.0, target=True),
    "wled_beat": flag(True),
    # #272: Hue lamps take the dream's colour as a mood (hue.py): on/off, the bridge's address, how bright (a MIDI fader
    # can move it; the master and its blackout act on top) and which lamps and rooms
    "hue_lamps": flag(False),
    "hue_bridge": text("", clean=_host),
    "hue_lamps_amt": num(1.0, 0.0, 1.0, target=True),
    "hue_lamps_sel": text("", clean=_hue_items),
    "pose": flag(False),                                        # the dancer's skeleton (flowtrack) shapes the figure
    "pose_scale": num(0.8, 0.2, 1.5, target=True, weight=0.5, needs="pose"),
    # what the Mac's camera detects: on (light: fire, LED) | hand (pose) | marker (#235: two LED markers, one per hand)
    "flow_kind": text("hand", choices=("on", "hand", "marker")),
    # #251: Dream Dance – the clutch (the dance acts only while it is engaged; released: only what the hands and the
    # controllers set; released after every start – hub.py – and engaged only on purpose) and the movement set in use
    # (#265: its sentences are the dance's table, dance.py)
    "clutch": flag(False),
    "dance_set": text("standard", clean=_set_name),
    # #266: whose measures the dance reads its base movements with – a profile's name (danceprofiles.py), "": the
    # standard measures
    "dance_profile": text("", clean=_set_name),
    "flow_auto": flag(True),                                    # #252: flowtrack's automatic chooses kind and exposure, holds the one person
    # … and what it detects for Dream Dance: a mode is a preset, so the dance keeps its own choice – light chosen for
    # flowtrack never becomes the dance's detection (a bright window would stand in for the hands)
    "dance_kind": text("hand", choices=("hand", "marker")),
    "flow_markers": flag(False),                                # … LED markers beside the hand AI (they lead in the dark)
    "marker_l": text("cyan", choices=MARKERS),                  # the marker colour of the left and the right hand
    "marker_r": text("magenta", choices=MARKERS),
    "dance_fb_secs": num(4.0, 1.0, 15.0),                       # #243: the seconds a "good"/"bad" of the dance lab keeps
    "drift": num(0.5, 0.0, 1.0, guest=True, target=True, weight=0.6),       # keeps the dream alive without new input (0 = off)
    "drift_prompt": flag(True, guest=True),
    "music_patterns": flag(True),                               # music: changing patterns, drop → next scene
    "music_drop": flag(True),
    "beat_snap": text("bar", choices=("off", "beat", "bar", "phrase")),   # #195: changes snap to the beat
    "smooth": num(0.3, 0.0, 1.0, guest=True, target=True, weight=0.5),      # smoothing: moving average of the shown pictures (0 = off)
    "morph": num(1.0, 0.0, 1.0, weight=0.5),                                # #194: motion between two AI pictures (0 = off)
    "flow": num(1.0, 0.0, 1.0, weight=0.4),                     # #205: shapes travel between two AI pictures (0 = off)
    # auto, or a fixed pattern (Pulse, Jolt, Jump, Flow; #133: old German names too)
    "music_pattern": text("auto", choices=("auto", *playlists.PATTERNS), guest=True,
                          clean=lambda v: playlists.OLD_PATTERNS.get(v, v)),
    "aspect": text("square", choices=("square", "wide")),       # picture format: square | wide (16:9)
    # direct touch – how direct; what the hands do (paint, stir, impulses, light) are targets of the mapping (#249)
    "touch_amt": num(0.6, 0.0, 1.0, weight=0.5, needs="move_mode"),
    "touch_mirror": flag(False),
    "master": num(1.0, 0.0, 1.0, target=True),                  # master brightness (MIDI fader, blackout): 0 = black
    "auto": flag(False),                                        # autopilot steers Dream by itself, led by the music
    "auto_level": num(0.5, 0.0, 1.0),
    "auto_media": flag(True),                                   # … also makes pictures/clips; camera/flowtrack only if allowed
    "auto_cam": flag(False),
    "auto_flow": flag(False),
    "ap_words": flag(True),
    "cam_device": text(""),
    "flow_device": text(""),
    "calib": text(""),                                          # camera → picture calibration (#92): JSON {h, delay}
    "flow_unproject": flag(False),
    "fast": flag(False),
    "fast_prev": text(""),
    "edges": flag(False),
    "edges_scale": num(0.8, 0.2, 1.5, weight=0.5, needs="edges"),
    "flow_color": text(""),
    "flow_short": flag(True),
    "style": text("", guest=True, clean=_style),                # #123: a style model (SDXL-Turbo) and its strength (0–2)
    "style_amt": num(1.0, 0.0, 2.0, guest=True),
    "style_ref": text("", clean=_style_ref),                    # #123: a style reference picture (id) and its strength
    "style_ref_amt": num(0.8, 0.0, 1.0),
    "fx": text("", guest=True, clean=_fx),                      # effects by hand: "tunnel+waves", their strength, pulse on the beat
    "fx_amt": num(0.7, 0.0, 1.0, guest=True, target=True, weight=0.8, needs="fx"),
    "fx_beat": flag(True, guest=True),
    "world": text("classic", choices=WORLDS),                   # #221: the style world of Dreamy Eyes and the dream windows
    # #224: the crossfade – the world it fades to, how far on the way (0 = all "world", 1 = all "world_to"; a MIDI knob
    # can turn it), and the drift: Dream wanders from world to world by itself, one every so many seconds (0 = off)
    "world_to": text("classic", choices=WORLDS),
    "world_mix": num(0.0, 0.0, 1.0, target=True),
    "world_auto": num(120, 0, 900),
}

# ---------- what the rest of Dream reads: views of the table ----------
DEFAULT_STATE = {k: s.default for k, s in SETTINGS.items()}
RANGES = {k: (s.lo, s.hi) for k, s in SETTINGS.items() if s.number}
CHOICES = {k: s.choices for k, s in SETTINGS.items() if s.choices}
GUEST_KEYS = {k for k, s in SETTINGS.items() if s.guest}
GUEST_MODES = SETTINGS["mode"].guest
TARGETS = {k: (s.lo, s.hi) for k, s in SETTINGS.items() if s.target}   # what a controller can move: key → (min, max)
# #216: where "Reset" brings the dream: every number that shapes the picture glides to its default (the ones with a
# weight); the effects, the autopilot, the music pattern (back to "auto") and the style (model, reference picture and
# both strengths: no style) are set in one step – a glide of a style strength would make the AI rebuild its model about
# once a second. #240: the master brightness comes back to full in one step too – a dimmed or blacked-out stage is lit
# again at once. Everything else stays – prompt, model, quality, size, format, cameras, playlist, output, cloud, and every
# other switch.
RESET_AT_ONCE = ("fx", "auto", "music_pattern", "style", "style_amt", "style_ref", "style_ref_amt", "master")
RESET = {k: s.default for k, s in SETTINGS.items() if s.weight or k in RESET_AT_ONCE}
assert not any(SETTINGS[k].weight for k in RESET_AT_ONCE)
assert all(s.number and 0 < s.weight <= 1 for s in SETTINGS.values() if s.weight)
assert all(s.needs in SETTINGS for s in SETTINGS.values() if s.needs)


def page_schema() -> dict:
    """#216: what a page needs to draw a number's slider (static/sliders.js): default, range, whether zero lies inside
    the range, the weight and the setting it only acts with."""
    return {k: {"d": s.default, "lo": s.lo, "hi": s.hi, **({"zero": True} if s.bipolar else {}),
                **({"w": s.weight} if s.weight else {}), **({"needs": s.needs} if s.needs else {}),
                **({"steps": list(s.steps)} if s.steps else {})}
            for k, s in SETTINGS.items() if s.number}


def guest_changes(changes: dict) -> dict:
    """#148: the part of a guest's changes a guest may make."""
    return {k: v for k, v in changes.items()
            if k in GUEST_KEYS and (SETTINGS[k].guest is True or (isinstance(v, str) and v in SETTINGS[k].guest))}


def coerce_number(k, v):
    """#175: a number of the default's type, finite and inside its range – or ValueError."""
    s = SETTINGS[k]
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        raise ValueError(k)
    f = float(str(v)[:40]) if isinstance(v, str) else float(v)
    if not math.isfinite(f):
        raise ValueError(k)
    f = min(max(f, s.lo), s.hi)
    if s.steps:                                    # #247: the nearest of its values (halfway: the smaller one)
        return min(s.steps, key=lambda step: (abs(step - f), step))
    return int(round(f)) if isinstance(s.default, int) else f


def coerce(k, v):
    """Accepts a value only in the type (and, for choices, the values) of the default."""
    s = SETTINGS[k]
    if isinstance(s.default, bool):
        return bool(v)
    if s.number:
        return coerce_number(k, v)
    v = str(v)[:2000]
    if s.clean:
        v = s.clean(v)
    if s.choices and v not in s.choices:
        raise ValueError(k)
    return v


def moved(saved: dict) -> dict:
    """#249: the saved state of a version with the cards "Movement", "Dance" and "Direct interaction" in today's
    terms: the movement switch ("flowtrack": off | on | hand | marker) becomes the mode – light is flowtrack, hands
    and markers are the dance unless "Dance steers the effects" was off – and what it detected the camera's kind. The
    switches of the old cards become rows of the mapping tables (dance.adopt). A state that has a mode is left alone."""
    if "move_mode" in saved or saved.get("flowtrack") not in ("on", "hand", "marker"):
        return saved
    kind = saved["flowtrack"]
    mode = "flowtrack" if kind == "on" or saved.get("dance") is False else "dance"
    return {**saved, "flow_kind": kind, "move_mode": mode, **({"dance_kind": kind} if mode == "dance" else {})}


def loaded(saved) -> dict:
    """The saved state on top of the defaults (#175: a broken number heals to its default; unknown keys are dropped;
    #249: settings of earlier versions are carried over first)."""
    state = dict(DEFAULT_STATE)
    saved = moved(saved) if isinstance(saved, dict) else saved
    for k, v in saved.items() if isinstance(saved, dict) else ():
        if k in SETTINGS:
            try:
                state[k] = coerce_number(k, v) if SETTINGS[k].number else v
            except (ValueError, TypeError, OverflowError):
                pass
    return state
