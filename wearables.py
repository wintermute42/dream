"""Devices worn on the body that speak Dream's own small protocol (#277): an M5Stack StickS3 on the wrist (its motion
sensor's raw data, its button as the dance's clutch) and an M5Stack ATOM Matrix as a display (the clutch and the beat).
The firmware is in `firmware/` (PlatformIO, M5Unified).

The protocol is OSC over UDP on the sensor port (DREAM_SENSOR_PORT, inputs.py), every address under /dream/wear/:

  device → Dream
    /dream/wear/hello  s id, s kind ("sticks3" | "matrix"), s token ("" until paired), i battery % (-1: unknown), s firmware
                       once a second – it says the device is there and asks for the state
    /dream/wear/imu    s id, i milliseconds (the device's clock), f ax, f ay, f az (g), f gx, f gy, f gz (degrees a second)
                       50–100 times a second
    /dream/wear/clutch s id, s token, i want (0 | 1), i seq – the button: "the clutch as I want it"; repeated with the
                       same seq until a state with that seq comes back (a lost packet changes nothing twice)
  Dream → device (to the address and port the device sent from)
    /dream/wear/state  i clutch (0 | 1), i paired (0 | 1), i seq (the last clutch seq Dream took from that device)
    /dream/wear/pair   s token – once the owner allowed the device in the panel; the device keeps it (NVS)
    /dream/wear/beat   f strength 0…1 – to the displays, the moment the stage hears a beat

Rights: only senders in the home network are heard (inputs.py, net.home_address). The motion is taken from every such
sender, like any OSC sensor (it moves nothing by itself: the mode's table and the clutch decide). The clutch is taken
only from a device the owner allowed in the panel (`allow`): Dream then gives the device a random token, kept in the
state folder (0600, never in a page, a log or the repository) and compared in constant time – a stray UDP packet in the
home network, or a device that only knows another's id, never moves the clutch (fail closed). `revoke` takes it back.

A device that sends nothing for GONE seconds is gone: the panel says so, and the clutch stays exactly as it was (the
dancer's last word stands; the panel, a MIDI button or key K still change it). A display needs no pairing: it only
shows the clutch and the beat.

Dream announces the port over mDNS as `_dream-osc._udp` (only with --lan, when the port listens in the home network),
with the system's own responder (`dns-sd` on macOS, `avahi-publish-service` on Linux); a device that does not find it
takes the address entered in its setup."""
import asyncio
import contextlib
import json
import math
import os
import re
import secrets
import shutil
import sys
import time

import paths

PREFIX = "/dream/wear/"
KINDS = ("sticks3", "matrix")
LOW_BATTERY = 15                 # % – the panel warns from here on
NAMES = {"sticks3": "StickS3", "matrix": "ATOM Matrix"}
GONE = 3.0                       # seconds without a packet: the device is gone (it says hello every second)
FORGET = 60.0                    # … and an unpaired device leaves the list after this long
MAX_DEVICES = 8
G = 9.80665                      # the device reports acceleration in g, the sensor input takes m/s²
BEAT_EVERY = 0.08                # seconds: at most about twelve beats a second to a display
SERVICE = "_dream-osc._udp"
ID = re.compile(r"[0-9a-f]{12}")
TOKEN = re.compile(r"[0-9a-f]{32}")
FIRMWARE = re.compile(r"[0-9A-Za-z.+-]{1,16}")


def store_file() -> str:
    return os.path.join(paths.state_dir(), "wearables.json")


def load() -> dict:
    """The devices the owner allowed: id → {"kind", "token"}. Anything odd in the file is left out (fail closed)."""
    try:
        with open(store_file()) as f:
            data = json.load(f)
    except (FileNotFoundError, ValueError, OSError):
        return {}
    devs = data.get("devices") if isinstance(data, dict) else None
    if not isinstance(devs, dict):
        return {}
    return {i: {"kind": d["kind"], "token": d["token"]} for i, d in devs.items()
            if isinstance(i, str) and ID.fullmatch(i) and isinstance(d, dict) and d.get("kind") in KINDS
            and isinstance(d.get("token"), str) and TOKEN.fullmatch(d["token"])}


def save(paired: dict) -> None:
    path = store_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump({"devices": paired}, f, indent=1)
    os.replace(path + ".tmp", path)


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _text(v, pattern) -> str | None:
    return v if isinstance(v, str) and pattern.fullmatch(v) else None


def osc(address: str, *args) -> bytes:
    """One OSC message (ints, floats, texts) as the firmware reads it."""
    from pythonosc.osc_message_builder import OscMessageBuilder
    b = OscMessageBuilder(address)
    for a in args:
        b.add_arg(a, "s" if isinstance(a, str) else "i" if isinstance(a, int) else "f")
    return b.build().dgram


class Device:
    def __init__(self, id_: str, kind: str, now: float):
        self.id, self.kind = id_, kind
        self.addr = None                 # (ip, port) it sends from: where the answers go
        self.at = now                    # monotonic: its last packet
        self.battery, self.firmware = -1, ""
        self.token_ok = False            # its hello carries the token it was given
        self.seq = 0                     # the last clutch seq taken from it
        self.refused = 0                 # presses refused (not allowed, or a wrong token)
        self.last = None                 # its last clutch wish taken: (on, monotonic time)
        self.dev_t = None                # its clock (ms) in the last motion packet …
        self.offset = None               # … and how far behind the wall clock that is (s): the samples keep its spacing
        self.n, self.rate, self.since = 0, 0.0, now
        self.beat_at = -1e9

    @property
    def name(self) -> str:
        return f"{NAMES[self.kind]} {self.id[-4:].upper()}"


class Wearables:
    """The worn devices: who is there, who is allowed, the answers. `feed(address, values, source, now, gyro_unit)`
    hands the motion to the sensor input (sensors.Sensors.on_osc); `events` holds the clutch wishes for the sensor loop
    (("clutch", on, device id)) – it applies them through hub.apply like every other way of the clutch."""

    def __init__(self, feed=None):
        self.feed = feed
        self.devices: dict = {}
        self.paired = load()
        self.transport = None            # the OSC server's UDP transport (inputs.sensor_loop): answers never wait
        self.events: list = []
        self.clutch = False              # what the devices are told (the setting, kept up to date by inputs.py)

    # ---------- incoming ----------
    def on_osc(self, address: str, args, client: tuple, now: float | None = None, wall: float | None = None) -> None:
        """One packet of a device in the home network (the caller checked the address)."""
        now = time.monotonic() if now is None else now
        wall = time.time() if wall is None else wall
        what = address[len(PREFIX):] if address.startswith(PREFIX) else ""
        args = list(args)
        id_ = _text(args[0], ID) if args else None
        if not id_:
            return
        if what == "hello" and len(args) >= 4 and args[1] in KINDS:
            dev = self._device(id_, args[1], now)
            if dev is None:
                return
            dev.addr, dev.at = tuple(client[:2]), now
            dev.battery = int(min(100, max(-1, args[3]))) if _num(args[3]) else -1
            dev.firmware = (_text(args[4], FIRMWARE) or "") if len(args) > 4 else ""
            token = args[2] if isinstance(args[2], str) else ""
            dev.token_ok = self.allowed(id_, token)
            if id_ in self.paired and not dev.token_ok:      # allowed, but it has not got (or lost) its token: again
                self.send(dev, "pair", self.paired[id_]["token"])
            self.tell(dev)
        elif what == "imu" and len(args) >= 8 and all(_num(a) for a in args[1:8]):
            dev = self._device(id_, "sticks3", now)
            if dev is None:
                return
            dev.addr, dev.at = tuple(client[:2]), now
            t = self._clock(dev, int(args[1]), wall)
            if t is None:
                return
            dev.n += 1
            if now - dev.since >= 1.0:
                dev.rate, dev.n, dev.since = dev.n / (now - dev.since), 0, now
            if self.feed:
                root = f"/sticks3/{id_[-6:]}/"
                self.feed(root + "accelerometer", [a * G for a in args[2:5]], dev.name, t, 1.0)
                self.feed(root + "gyroscope", list(args[5:8]), dev.name, t, math.radians(1))
        elif what == "clutch" and len(args) >= 4 and isinstance(args[1], str) and _num(args[2]) and _num(args[3]):
            dev = self.devices.get(id_)
            if dev is None or dev.kind != "sticks3":
                return
            dev.addr, dev.at = tuple(client[:2]), now
            seq = int(args[3])
            if not self.allowed(id_, args[1]):
                dev.refused += 1
                self.tell(dev)                               # "not allowed": the device shows it, nothing changes
                return
            if seq != dev.seq:                               # a repeat of a press already taken changes nothing again
                dev.seq = seq
                dev.last = (bool(args[2]), now)
                self.events.append(("clutch", bool(args[2]), id_))
            else:
                self.tell(dev)

    def _device(self, id_: str, kind: str, now: float) -> Device | None:
        dev = self.devices.get(id_)
        if dev is not None:
            return dev if dev.kind == kind else None
        self.sweep(now)
        if len(self.devices) >= MAX_DEVICES:
            return None
        dev = self.devices[id_] = Device(id_, kind, now)
        return dev

    def _clock(self, dev: Device, ms: int, wall: float) -> float | None:
        """The wall-clock time of a motion sample: the device's own spacing (its clock), placed where the packets come
        in. A packet older than the last one (UDP may swap them) is dropped; a clock that jumped (a restart) starts anew."""
        t = ms / 1000.0
        if dev.dev_t is not None:
            back = dev.dev_t - t
            if 0 <= back < 10:
                return None
            if back >= 10 or t - dev.dev_t > 10:
                dev.offset = None
        dev.dev_t = t
        lag = wall - t
        # the smallest delay seen is the network's least: the offset follows it at once downwards, slowly upwards
        dev.offset = lag if dev.offset is None or lag < dev.offset else dev.offset + (lag - dev.offset) * 0.01
        return t + dev.offset

    def allowed(self, id_: str, token) -> bool:
        p = self.paired.get(id_)
        return bool(p) and p["kind"] == "sticks3" and isinstance(token, str) and bool(TOKEN.fullmatch(token)) \
            and secrets.compare_digest(p["token"], token)

    # ---------- the owner's word (the panel; Control-only, ctl.py) ----------
    def allow(self, id_, now: float | None = None) -> bool:
        """The owner allows this StickS3's button to move the clutch: a new token, sent to it at once (and with every
        answer to its hello until it has it). Only a device that is there right now."""
        dev = self.devices.get(id_) if isinstance(id_, str) else None
        if dev is None or dev.kind != "sticks3" or not self.live(dev, now):
            return False
        token = secrets.token_hex(16)
        self.paired[id_] = {"kind": dev.kind, "token": token}
        save(self.paired)
        dev.token_ok = False
        self.send(dev, "pair", token)
        self.tell(dev)
        return True

    def revoke(self, id_) -> bool:
        if not isinstance(id_, str) or id_ not in self.paired:
            return False
        self.paired.pop(id_)
        save(self.paired)
        dev = self.devices.get(id_)
        if dev is not None:
            dev.token_ok = False
            self.tell(dev)
        return True

    # ---------- outgoing: never awaited ----------
    def send(self, dev: Device, what: str, *args) -> None:
        if self.transport is None or dev.addr is None:
            return
        with contextlib.suppress(OSError, RuntimeError):     # a closed transport, a full buffer: the next one comes
            self.transport.sendto(osc(PREFIX + what, *args), dev.addr)

    def tell(self, dev: Device) -> None:
        paired = int(dev.kind == "sticks3" and dev.id in self.paired)
        self.send(dev, "state", int(self.clutch), paired, dev.seq)

    def tell_all(self, clutch: bool, now: float | None = None) -> None:
        """The clutch changed (whoever changed it): every device that is there hears it."""
        now = time.monotonic() if now is None else now
        self.clutch = bool(clutch)
        for dev in list(self.devices.values()):
            if self.live(dev, now):
                self.tell(dev)

    def beat(self, v, now: float | None = None) -> None:
        """The stage heard a beat: the displays blink with it."""
        if not _num(v) or v <= 0:
            return
        now = time.monotonic() if now is None else now
        for dev in list(self.devices.values()):
            if dev.kind == "matrix" and self.live(dev, now) and now - dev.beat_at >= BEAT_EVERY:
                dev.beat_at = now
                self.send(dev, "beat", float(min(1.0, v)))

    # ---------- what the panel shows ----------
    def live(self, dev: Device, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        return now - dev.at < GONE

    def displays(self, now: float | None = None) -> int:
        return sum(1 for d in self.devices.values() if d.kind == "matrix" and self.live(d, now))

    def sweep(self, now: float) -> None:
        for k in [k for k, d in self.devices.items() if k not in self.paired and now - d.at > FORGET]:
            self.devices.pop(k)

    def listing(self, now: float | None = None) -> list:
        """Every device that is there or was lately, and every allowed one: never a token, never an address."""
        now = time.monotonic() if now is None else now
        self.sweep(now)
        out = []
        for id_ in sorted(set(self.devices) | set(self.paired)):
            dev, p = self.devices.get(id_), self.paired.get(id_)
            kind = dev.kind if dev else p["kind"]
            live = bool(dev) and self.live(dev, now)
            out.append({"id": id_, "name": dev.name if dev else f"{NAMES[kind]} {id_[-4:].upper()}", "kind": kind,
                        "live": live, "seen": round(now - dev.at) if dev else None,
                        "battery": dev.battery if dev and live else -1,
                        "rate": round(dev.rate) if dev and live and now - dev.since < 2.5 else 0,
                        "low": bool(dev) and live and 0 <= dev.battery <= LOW_BATTERY,
                        "last": {"on": dev.last[0], "ago": round(now - dev.last[1])}
                        if dev and dev.last else None,
                        "paired": bool(p), "ready": bool(p) and bool(dev) and dev.token_ok,
                        "refused": dev.refused if dev else 0, "firmware": dev.firmware if dev else ""})
        return out

    def msg(self, port: int, lan: bool, now: float | None = None) -> dict:
        """lan: whether the port listens in the home network at all (dream.sh --lan)."""
        return {"wear": {"devices": self.listing(now), "port": port, "lan": bool(lan), "advert": advert["on"],
                         "displays": self.displays(now)}}


# ---------- mDNS: Dream's sensor port in the home network ----------
advert: dict = {"proc": None, "on": False}


def advert_cmd(port: int, platform: str = sys.platform, which=shutil.which) -> list | None:
    """The command that announces the port with the system's own mDNS responder, or None (there is none)."""
    if platform == "darwin" and which("dns-sd"):
        return ["dns-sd", "-R", "Dream", SERVICE, "local", str(int(port))]
    if platform.startswith("linux") and which("avahi-publish-service"):
        return ["avahi-publish-service", "Dream", SERVICE, str(int(port))]
    return None


async def advertise(port: int) -> None:
    """Announces the sensor port as long as Dream runs (the responder stops with `stop_advert`)."""
    cmd = advert_cmd(port)
    if not cmd or advert["proc"] is not None:
        return
    with contextlib.suppress(OSError):
        advert["proc"] = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.DEVNULL,
                                                              stdout=asyncio.subprocess.DEVNULL,
                                                              stderr=asyncio.subprocess.DEVNULL)
        advert["on"] = True
        print(f"Sensor port announced over mDNS as {SERVICE}", flush=True)


def stop_advert() -> None:
    proc, advert["proc"], advert["on"] = advert["proc"], None, False
    if proc is not None and proc.returncode is None:
        with contextlib.suppress(ProcessLookupError, OSError):
            proc.terminate()
