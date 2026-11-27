"""The USB receiver (#278): an M5Stack AtomS3 Lite on the Mac's USB takes the packets of the StickS3s paired with it by
radio (ESP-NOW – straight from the wrist, no Wi-Fi in between) and hands them over its USB serial line; Dream answers
the same way. Every packet is the stick's own OSC of #277: it goes into the one path of the worn devices
(`wearables.Wearables.on_osc(..., via=<the receiver>)`) – motion, the clutch's token, the panel's list, all as over the
Wi-Fi. The firmware is `firmware/atoms3-receiver/`, the radio and the serial line are described in
`firmware/lib/DreamRadio/src/DreamRadio.h`:

  receiver → Dream   H <proto> <id> <firmware> <channel> <pairing s left> <peers>   (peers: "-" or mac[*],…; "*": paired
                                                     by its button, not yet taken by Dream)
                     P <mac> <hex>                   a packet of a paired stick
                     B                               its button: the clutch the other way
  Dream → receiver   ?  ·  T <mac> <hex>  ·  L g|b|r (the LED, also Dream's sign of life)  ·  K <mac>  ·  W (pairing)  ·
                     C <channel>

Finding it: every USB serial port of the kind an ESP32-S3 makes (`/dev/cu.usbmodem*` on macOS, `/dev/ttyACM*` on Linux –
the StickS3 has the same USB ids, so the ids alone cannot tell them apart) is opened once when it appears and only
*listened* to for PROBE_WAIT seconds: a receiver says its H line every two seconds by itself; anything else is closed
again and left alone until it is unplugged – Dream never writes to a port that has not said it is a receiver. A port is
held exclusively (flock and TIOCEXCL): esptool locks it the same way, so flashing and Dream never write into each
other; `firmware/flash.sh` also leaves a note in the state folder (`flashing`) while it runs, and Dream lets go of every
port then. DREAM_RECEIVER=off switches all this off; DREAM_RECEIVER=<port>[,<port>] names the ports (the tests: a pty).

Trust: the receiver is on the Mac's USB – it is trusted like key K: its button moves the clutch, and a stick paired by
its button (the owner pressed it, the stick was switched on next to it) is allowed at its first hello (Dream gives it the
token of #277; "Revoke" in the panel takes it back as for every stick, its motion keeps counting). By radio only the
sticks on its list are heard – the firmware drops the others, Dream checks it again, and that a packet names the stick it
came from; everything between a stick and the receiver is encrypted with a key of that stick's own.

The channel (DREAM_ESPNOW_CHANNEL, 1 … 13, default 1): the receiver is never on a Wi-Fi, so it keeps one fixed channel
Dream tells it; a stick on the radio is not on the Wi-Fi either and follows the receiver's channel by itself (it is
told at the pairing and searches all channels when it loses the receiver). Choose a channel away from the home Wi-Fi's
for the least interference (README: Worn devices)."""
import asyncio
import contextlib
import fcntl
import glob
import os
import re
import select
import termios
import threading
import time

import paths
import wearables

PROTO = "1"
PROBE_WAIT = 2.5                 # seconds a new port is listened to for an H line
WATCH_EVERY = 2.0                # seconds between two looks at the USB ports
SILENT = 6.0                     # no line of the receiver this long: it is not working (the panel says so)
LED_EVERY = 1.0                  # the LED is said at least this often (the receiver's sign that Dream listens)
PAUSE_MAX = 600.0                # a note of flash.sh older than this is left over (a killed run) and ignored
MAX_LINE = 1024
MAC = re.compile(r"[0-9a-f]{12}")
HEX = re.compile(r"(?:[0-9a-f]{2}){4,247}")
FIRMWARE = re.compile(r"[0-9A-Za-z.+-]{1,16}")
NAME = "AtomS3 receiver"


def channel() -> int:
    try:
        ch = int(os.environ.get("DREAM_ESPNOW_CHANNEL") or 1)
    except ValueError:
        return 1
    return ch if 1 <= ch <= 13 else 1


def candidates() -> list:
    """The USB serial ports a receiver may be on, or the ones DREAM_RECEIVER names; none with DREAM_RECEIVER=off."""
    named = (os.environ.get("DREAM_RECEIVER") or "").strip()
    if named.lower() in ("0", "off", "no", "false"):
        return []
    if named:
        return [p for p in named.split(",") if p]
    return sorted(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/ttyACM*"))


def pause_file() -> str:
    return os.path.join(paths.state_dir(), "flashing")


def paused(wall: float | None = None) -> bool:
    """firmware/flash.sh runs right now: no port is opened or held. A note whose script is gone (killed) or that is
    older than PAUSE_MAX is left over and counts for nothing."""
    try:
        age = (time.time() if wall is None else wall) - os.stat(pause_file()).st_mtime
        with open(pause_file()) as f:
            pid = f.read(32).strip()
    except OSError:
        return False
    if pid.isdigit():
        try:
            os.kill(int(pid), 0)
        except ProcessLookupError:
            return False
        except OSError:                      # there, but not ours to signal: it runs
            pass
    return -60 < age < PAUSE_MAX


def open_port(path: str) -> int:
    """The port, raw, 115200 baud, never blocking, held exclusively; the lines DTR/RTS are left as the system sets them
    (an ESP32-S3 restarts on some of their changes) and stay so when it is closed."""
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with contextlib.suppress(OSError):
            fcntl.ioctl(fd, termios.TIOCEXCL)
        iflag, oflag, cflag, lflag, ispeed, ospeed, cc = termios.tcgetattr(fd)
        iflag &= ~(termios.IGNBRK | termios.BRKINT | termios.PARMRK | termios.ISTRIP | termios.INLCR | termios.IGNCR
                   | termios.ICRNL | termios.IXON | termios.IXOFF)
        oflag &= ~termios.OPOST
        lflag &= ~(termios.ECHO | termios.ECHONL | termios.ICANON | termios.ISIG | termios.IEXTEN)
        cflag = (cflag & ~(termios.CSIZE | termios.PARENB | termios.HUPCL)) | termios.CS8 | termios.CREAD | termios.CLOCAL
        cc[termios.VMIN], cc[termios.VTIME] = 0, 0
        termios.tcsetattr(fd, termios.TCSANOW, [iflag, oflag, cflag, lflag, termios.B115200, termios.B115200, cc])
    except (OSError, termios.error):
        close_port(fd)
        raise
    return fd


def close_port(fd: int) -> None:
    """Let go: exclusive no more (on Linux that would outlast the close while another holds the port), then closed."""
    with contextlib.suppress(OSError):
        fcntl.ioctl(fd, termios.TIOCNXCL)
    with contextlib.suppress(OSError):
        os.close(fd)


def probe(path: str, wait: float = PROBE_WAIT) -> tuple | bool:
    """Listens to a port for an H line (nothing is written): (fd, what came) for a receiver; False: it is something
    else (closed again); True: it could not be opened right now (held by another, e.g. esptool) – tried again later."""
    try:
        fd = open_port(path)
    except (OSError, termios.error):
        return True
    got, until = b"", time.monotonic() + wait
    try:
        while time.monotonic() < until and len(got) < 8 * MAX_LINE:
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                chunk = os.read(fd, 4096)
                if not chunk:
                    break
                got += chunk
                if any(line.startswith(b"H " + PROTO.encode() + b" ") for line in got.split(b"\n")[:-1]):
                    return fd, got
    except OSError:
        pass
    close_port(fd)
    return False


class Receiver:
    """One receiver on a USB port: its lines in (a thread reads, the event loop handles), Dream's lines out (never
    waiting: what does not fit right now is dropped – the next packet is on its way)."""

    def __init__(self, path: str, fd: int, wear, loop, other=None):
        self.path, self.fd, self.wear, self.loop = path, fd, wear, loop
        self.other = other                   # (address, args, source): a stick's ordinary sensor OSC (its second button)
        self.id, self.firmware, self.channel, self.pair_until = None, "", 0, 0.0
        self.peers: dict = {}                # mac → paired by the button and not yet taken by Dream
        self.heard = 0.0                     # monotonic: its last line
        self.led, self.led_at, self.asked_channel = None, -1e9, -1e9
        self.taken: dict = {}                # mac → when K was said (said again until its H shows it)
        self.buf = b""
        self.lock = threading.Lock()
        self.closed = False
        self.thread = None

    # ---------- the line ----------
    def start(self, first: bytes = b"") -> None:
        if first:
            self.feed(first, time.monotonic(), time.time())
        self.thread = threading.Thread(target=self._read, name=f"receiver {self.path}", daemon=True)
        self.thread.start()

    def _read(self) -> None:
        while not self.closed:
            try:
                r, _, _ = select.select([self.fd], [], [], 0.25)
                if not r:
                    continue
                chunk = os.read(self.fd, 4096)
            except BlockingIOError:
                continue
            except (OSError, ValueError):     # unplugged, or closed meanwhile
                break
            if not chunk:
                break
            now, wall = time.monotonic(), time.time()
            with contextlib.suppress(RuntimeError):          # the loop is closing
                self.loop.call_soon_threadsafe(self.feed, chunk, now, wall)
        with self.lock:                      # the thread lets go of the port itself: its number is never read twice
            self.closed = True
            close_port(self.fd)
        with contextlib.suppress(RuntimeError):
            self.loop.call_soon_threadsafe(self.close)

    def write(self, line: str) -> bool:
        if self.closed:
            return False
        data = (line + "\n").encode()
        with self.lock:
            if self.closed:
                return False
            try:
                return os.write(self.fd, data) == len(data)
            except (BlockingIOError, InterruptedError):
                return False
            except OSError:
                return False

    def close(self) -> None:
        """Let go of it (unplugged, flash.sh, Dream ends): a reading thread closes the port itself within a moment."""
        with self.lock:
            reading = self.thread is not None and self.thread.is_alive()
            if not self.closed and not reading:
                close_port(self.fd)
            self.closed = True
        if links.get(self.path) is self:
            links.pop(self.path)
        for dev in self.wear.devices.values():      # its sticks: gone from this way (the next packet decides anew)
            if dev.via is self:
                dev.via, dev.addr = None, None

    # ---------- what comes in ----------
    def feed(self, chunk: bytes, now: float, wall: float) -> None:
        self.buf += chunk
        *lines, self.buf = self.buf.split(b"\n")
        if len(self.buf) > MAX_LINE:                 # no end in sight: thrown away
            self.buf = b""
        for raw in lines:
            if len(raw) <= MAX_LINE:
                with contextlib.suppress(UnicodeDecodeError):
                    self.line(raw.decode("ascii").strip(), now, wall)

    def line(self, text: str, now: float, wall: float) -> None:
        parts = text.split(" ")
        what = parts[0]
        if what == "H" and len(parts) == 7 and parts[1] == PROTO and MAC.fullmatch(parts[2]):
            ch, left = parts[4], parts[5]
            if not (ch.isdigit() and 1 <= int(ch) <= 13 and left.isdigit()):
                return
            peers = {}
            for p in ([] if parts[6] == "-" else parts[6].split(",")):
                mac, fresh = (p[:-1], True) if p.endswith("*") else (p, False)
                if not MAC.fullmatch(mac):
                    return
                peers[mac] = fresh
            self.id, self.channel, self.peers, self.heard = parts[2], int(ch), peers, now
            self.firmware = parts[3] if FIRMWARE.fullmatch(parts[3]) else ""
            self.pair_until = now + int(left) if int(left) else 0.0
            self.taken = {m: t for m, t in self.taken.items() if peers.get(m)}
            return
        if self.id is None:                  # nothing before it said who it is
            return
        self.heard = now
        if what == "B" and len(parts) == 1:  # its button: the clutch the other way (inputs.wear_events)
            self.wear.events.append(("clutch", None, f"receiver:{self.id}"))
        elif what == "P" and len(parts) == 3 and MAC.fullmatch(parts[1]) and HEX.fullmatch(parts[2]):
            self.packet(parts[1], bytes.fromhex(parts[2]), now, wall)

    def packet(self, mac: str, data: bytes, now: float, wall: float) -> None:
        if mac not in self.peers:            # only the sticks paired with it (the firmware drops the others too)
            return
        from pythonosc.osc_message import OscMessage
        try:
            m = OscMessage(data)
        except Exception:                    # python-osc raises several kinds for a broken packet
            return
        args = list(m.params)
        if m.address.startswith(wearables.PREFIX):
            if not args or args[0] != mac:   # a packet names the stick it came from, never another
                return
            self.wear.on_osc(m.address, args, ("esp-now", mac), now=now, wall=wall, via=self)
            if m.address == wearables.PREFIX + "hello" and self.peers.get(mac):
                self.take(mac, now)
        elif m.address.startswith(f"/sticks3/{mac[-6:]}/") and self.other:   # its second button (the lab's feedback)
            dev = self.wear.devices.get(mac)
            self.other(m.address, args, dev.name if dev else mac)

    def take(self, mac: str, now: float) -> None:
        """A stick paired by the receiver's button says hello: allowed (the button was the owner's word), and the
        receiver hears that Dream took it."""
        if mac not in self.wear.paired and not self.wear.allow(mac, now):
            return
        if now - self.taken.get(mac, -1e9) >= 1.0:
            self.taken[mac] = now
            self.write(f"K {mac}")

    # ---------- what goes out ----------
    def sendto(self, data: bytes, addr) -> None:
        """Like the UDP transport's: an OSC packet to ("esp-now", mac)."""
        if isinstance(addr, tuple) and len(addr) == 2 and addr[0] == "esp-now" and MAC.fullmatch(str(addr[1])):
            self.write(f"T {addr[1]} {data.hex()}")

    def alive(self, now: float) -> bool:
        return self.id is not None and now - self.heard < SILENT

    def led_for(self, clutch: bool, now: float) -> str:
        """green: a wristband is there by radio over this receiver and the clutch is engaged; blue: there, released;
        red: no wristband here."""
        if not self.wear.via_live(self, now):
            return "r"
        return "g" if clutch else "b"

    def tick(self, clutch: bool, now: float) -> None:
        if not self.alive(now):
            return
        led = self.led_for(clutch, now)
        if led != self.led or now - self.led_at >= LED_EVERY:
            if self.write(f"L {led}"):
                self.led, self.led_at = led, now
        want = channel()
        if self.channel != want and now - self.asked_channel >= 5.0:
            self.asked_channel = now
            self.write(f"C {want}")

    def listing(self, now: float) -> dict:
        """What the panel shows: never a port's path, never a key."""
        sticks = self.wear.via_live(self, now)
        return {"id": self.id, "name": f"{NAME} {self.id[-4:].upper()}", "live": self.alive(now),
                "channel": self.channel, "pairing": max(0, round(self.pair_until - now)) if self.pair_until else 0,
                "peers": len(self.peers), "sticks": [d.name for d in sticks], "firmware": self.firmware,
                "led": self.led or "r"}


# ---------- the receivers plugged in ----------
links: dict = {}                         # path → Receiver
skip: set = set()                        # ports that are no receiver (left alone until they are unplugged)


def channel_for(id_: str, now: float | None = None) -> int | None:
    """For wearables.Wearables.radio_for: the channel of a receiver this stick is paired with, while it works."""
    now = time.monotonic() if now is None else now
    for r in list(links.values()):
        if r.alive(now) and id_ in r.peers:
            return r.channel
    return None


def tick(clutch: bool, now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    for r in list(links.values()):
        r.tick(clutch, now)


def listing(now: float | None = None) -> list:
    now = time.monotonic() if now is None else now
    return [r.listing(now) for r in sorted(links.values(), key=lambda r: r.id or "") if r.id]


def open_pairing(id_) -> bool:
    """The panel's "Pair a wristband": the receiver opens its pairing window (as when its button is held)."""
    for r in list(links.values()):
        if r.id is not None and r.id == id_:
            return r.write("W")
    return False


def stop() -> None:
    for r in list(links.values()):
        r.close()
    skip.clear()


async def look(wear, other=None) -> None:
    """One look at the USB ports: new ones listened to, unplugged ones let go."""
    if paused():
        stop()
        return
    present = set(candidates())
    skip.intersection_update(present)
    for path in [p for p in links if p not in present]:
        links[path].close()
    loop = asyncio.get_running_loop()
    for path in sorted(present - set(links) - skip):
        found = await asyncio.to_thread(probe, path)
        if found is False:
            skip.add(path)
        if isinstance(found, bool):
            continue
        if paused() or path in links:                 # flash.sh began meanwhile
            close_port(found[0])
            continue
        r = links[path] = Receiver(path, found[0], wear, loop, other)
        r.start(found[1])
        r.write("?")
        print(f"USB receiver on {path}", flush=True)


async def watch(wear, other=None) -> None:
    """As long as Dream runs (inputs.sensor_loop starts it)."""
    try:
        while True:
            with contextlib.suppress(OSError):
                await look(wear, other)
            await asyncio.sleep(WATCH_EVERY)
    finally:
        stop()
