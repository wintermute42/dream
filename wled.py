"""The room light's LED chain (#212): one WLED device (an ESP32 LED controller) lights its whole chain in the dream's
colour (roomlight.py: what the audience sees, smoothed, with the beat's pulse, a flash and the master and its
blackout), sent FPS times a second over DDP (UDP, port 4048) – never awaited: a device that does not answer slows
nothing down. When the stage tells no colour any more (closed, hidden) or the light is switched off, Dream stops sending
and asks WLED to go back to its own program at once; if that word does not arrive, WLED's own realtime timeout (2.5 s
by default) does the same.

The device is an address in the home network – an IP or a name such as wled-room.local, entered or found over mDNS
(`_wled._tcp`, find(), mdns.py). Dream sends only to private, link-local or loopback addresses (net.home_address).
Its LED count is read from WLED's JSON API (/json/info) with a short timeout beside the sending; without an answer
Dream sends a whole packet of pixels (WLED ignores the ones it does not have). The chain is a colour per LED (compose): the dream's colour is the
bottom layer, further layers hang in on top (LAYERS), the strength and the master act last."""
import asyncio
import contextlib
import json
import struct
import time
import urllib.request

import hub
import mdns
import net
import outbox
import rights
import roomlight

PORT = 4048                      # DDP
FPS = 40                         # frames a second to the device
MAX_LEDS = 1500
PER_PACKET = 480                 # DDP: at most 1440 bytes of RGB in one packet
UNKNOWN_LEDS = PER_PACKET        # the count is not known: one full packet (WLED ignores the pixels it does not have)
RETRY = 5.0                      # seconds before an address that could not be used is tried again
HTTP_TIMEOUT = 1.5


# ---------- DDP: the packets ----------
DDP_VER1, DDP_PUSH, DDP_RGB24, DDP_DISPLAY = 0x40, 0x01, 0x0B, 1


def ddp(rgb: bytes, seq: int) -> list:
    """One frame as DDP packets: 10 bytes of header (flags, sequence 1–15, data type RGB 8 bit, the display, the offset
    and length of the data) and at most PER_PACKET pixels each; the last one carries the push flag – WLED shows the
    frame when it arrives."""
    step, out = PER_PACKET * 3, []
    for off in range(0, max(len(rgb), 1), step):
        part = rgb[off:off + step]
        last = off + step >= len(rgb)
        out.append(struct.pack("!BBBBIH", DDP_VER1 | (DDP_PUSH if last else 0), seq & 0x0F or 1, DDP_RGB24, DDP_DISPLAY,
                               off, len(part)) + part)
    return out


# ---------- the chain: one colour per LED ----------
# The base colour is the bottom layer of every LED. Further layers (#270: the dance's flash, a running pulse, a
# brightness of its own) hang themselves in here: layer(buf, dt, now) changes buf – a list with one [r, g, b] (floats
# 0–255) per LED – in place, in their order. The strength, the master and its blackout act after all of them
# (encode), so no layer can light a blacked-out chain.
LAYERS: list = []


def compose(base: tuple, n: int, dt: float, now: float) -> list | None:
    """The chain of n LEDs with the base colour and the layers on top – None when no layer is hung in (one colour)."""
    if not LAYERS:
        return None
    buf = [list(base) for _ in range(n)]
    for layer in LAYERS:
        layer(buf, dt, now)
    return buf


def encode(base: tuple, buf: list | None, n: int, level: float) -> bytes:
    """The RGB bytes of the chain, the level (strength × master) applied last."""
    byte = lambda c: min(255, max(0, round(c * level)))
    if buf is None:
        return bytes(byte(c) for c in base) * n
    return bytes(byte(c) for px in buf for c in px)


# ---------- the device's JSON API: beside the sending, short timeouts ----------
def _http(url: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"} if body is not None else {})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:     # noqa: S310 – a home-network address (net.home_address)
        return json.loads(r.read(65536) or b"{}")


def info(ip: str) -> dict:
    """{"leds": n, "name": "…"} of the device, or {} if it does not answer (blocking: run beside the loop)."""
    try:
        d = _http(f"http://{ip}/json/info")
        n = int(d.get("leds", {}).get("count") or 0)
        return {"leds": min(MAX_LEDS, n) if n > 0 else 0, "name": str(d.get("name") or "")[:40]}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def release(ip: str) -> None:
    """Asks WLED to leave the live mode at once and go back to its own program (blocking: run beside the loop). If it
    does not arrive, the device's realtime timeout does the same a moment later."""
    with contextlib.suppress(OSError, ValueError):
        _http(f"http://{ip}/json/state", {"live": False})


# ---------- the sender ----------
status: dict = {"st": "off"}
wake = asyncio.Event()                  # a setting of the light changed
run: dict = {"seq": 0, "sent": 0}


def _say(**st) -> None:
    """The light's status to every page that may change it (the panel, Dream Control) – only when it changed."""
    if st == status:
        return
    status.clear()
    status.update(st)
    text = json.dumps(msg())
    for c, r in list(hub.roles.items()):
        if rights.can(r, "control"):
            outbox.post(c, text)


def msg() -> dict:
    return {"wled": dict(status)}


def sync() -> None:
    """A setting of the light changed (hub.on_change): the sender looks again."""
    wake.set()


async def _until_wake(secs: float) -> bool:
    """Waits secs or until a setting changes; True if one did."""
    with contextlib.suppress(asyncio.TimeoutError):
        await asyncio.wait_for(wake.wait(), secs)
    return wake.is_set()


async def keep() -> None:
    """Runs as long as Dream does (server.py): sends while the light is on, a device is entered and the stage tells
    its colour."""
    while True:
        wake.clear()
        on, host = hub.state.get("wled"), hub.state.get("wled_host") or ""
        if not on:
            _say(st="off")
            await wake.wait()
            continue
        if not host:
            _say(st="nohost")
            await wake.wait()
            continue
        _say(st="looking", host=host)
        ip = await net.resolve(host)
        if wake.is_set():
            continue
        if not ip:
            _say(st="unknown", host=host)
            await _until_wake(RETRY)
            continue
        if not net.home_address(ip):
            _say(st="public", host=host)
            await wake.wait()
            continue
        try:
            await session(host, ip)
        except Exception as e:                     # never the end of the light for the rest of the show
            print("room light:", repr(e)[:200], flush=True)
            _say(st="unknown", host=host)
            await _until_wake(RETRY)


class _Quiet(asyncio.DatagramProtocol):
    def error_received(self, exc):              # e.g. nobody listens there: the next frame simply goes too
        pass


async def session(host: str, ip: str) -> None:
    """Sends to one device until a setting changes; then lets it go back to its own program."""
    loop = asyncio.get_running_loop()
    found: dict = {}
    asked = loop.run_in_executor(None, info, ip)       # the LED count, beside the sending
    try:
        transport, _ = await loop.create_datagram_endpoint(_Quiet, remote_addr=(ip, PORT))
    except OSError:
        _say(st="unknown", host=host)
        await _until_wake(RETRY)
        return
    live, last, nxt = False, time.monotonic(), time.monotonic()
    try:
        while not wake.is_set():
            now = time.monotonic()
            if asked is not None and asked.done():
                found = asked.result() or {"none": True}
                asked = None
            if not roomlight.light.fresh(now):                # the stage is closed or hidden: WLED back to its own program
                if live:
                    live, run["ip"] = False, None
                    loop.run_in_executor(None, release, ip)
                _say(st="wait", host=host, ip=ip, **_known(found))
                await _until_wake(0.25)
                last = nxt = time.monotonic()
                continue
            live, run["ip"] = True, ip
            _say(st="live", host=host, ip=ip, **_known(found))
            dt, last = min(max(now - last, 0.0), 0.25), now
            n = found.get("leds") or UNKNOWN_LEDS
            base = roomlight.light.lit(now, bool(hub.state.get("wled_beat", True)))
            amt = max(0.0, min(1.0, float(hub.state.get("wled_amt", 1.0))))
            level = roomlight.light.master(now, hub.state.get("master", 1.0)) * amt
            rgb = encode(base, compose(base, n, dt, now), n, level)
            if transport.get_write_buffer_size() < 64 * 1024:    # never a queue that grows: a frame is skipped
                run["seq"] = run["seq"] % 15 + 1
                for p in ddp(rgb, run["seq"]):
                    transport.sendto(p)
                run["sent"] += 1
            nxt = max(nxt + 1 / FPS, now)
            await _until_wake(max(0.0, nxt - time.monotonic()))
    finally:
        transport.close()
        if asked is not None:
            asked.cancel()
        if live and run.get("ip"):
            run["ip"] = None
            loop.run_in_executor(None, release, ip)


def stop() -> None:
    """Dream stops (server.py): a device that shows Dream's light right now goes back to its own program at once."""
    ip, run["ip"] = run.get("ip"), None
    if ip:
        release(ip)


def _known(found: dict) -> dict:
    """What the status tells of the device: its LED count and name, or that its JSON API does not answer."""
    if found.get("leds"):
        return {"leds": found["leds"], "name": found.get("name", "")}
    return {"noinfo": True} if found else {}


# ---------- mDNS: WLED devices in the network ----------
SERVICE = "_wled._tcp.local"


async def find() -> list:
    """The WLED devices in the network, found in about two seconds beside the loop."""
    return await asyncio.get_running_loop().run_in_executor(None, mdns.browse, SERVICE, 2.0)


hub.on_change("wled", sync)
hub.on_change("wled_host", sync)
