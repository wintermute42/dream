"""The room light's LED chain (#212): one WLED device (an ESP32 LED controller) lights its whole chain in the dream's
colour (roomlight.py: what the audience sees, smoothed, with the beat's pulse, a flash and the master and its
blackout), sent FPS times a second over DDP (UDP, port 4048) – never awaited: a device that does not answer slows
nothing down. When the stage tells no colour any more (closed, hidden) or the light is switched off, Dream stops sending
and asks WLED to go back to its own program at once; if that word does not arrive, WLED's own realtime timeout (2.5 s
by default) does the same.

The device is an address in the home network – an IP or a name such as wled-room.local, entered or found over mDNS
(`_wled._tcp`, find()). Dream sends only to private, link-local or loopback addresses. Its LED count is read from
WLED's JSON API (/json/info) with a short timeout beside the sending; without an answer Dream sends a whole packet of
pixels (WLED ignores the ones it does not have). The chain is a colour per LED (compose): the dream's colour is the
bottom layer, further layers hang in on top (LAYERS), the strength and the master act last."""
import asyncio
import contextlib
import ipaddress
import json
import select
import socket
import struct
import time
import urllib.request

import hub
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


def home_address(ip: str) -> bool:
    """Only to a device in the home network (or this Mac): fail closed for anything else."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.version == 4 and (a.is_private or a.is_link_local or a.is_loopback) and not a.is_multicast


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
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:     # noqa: S310 – a home-network address (home_address)
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


async def _resolve(host: str) -> str | None:
    try:
        ipaddress.IPv4Address(host)
        return host
    except ValueError:
        pass
    try:
        got = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, None, family=socket.AF_INET,
                                                                            type=socket.SOCK_DGRAM), 3.0)
        return got[0][4][0] if got else None
    except (OSError, asyncio.TimeoutError, IndexError):
        return None


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
        ip = await _resolve(host)
        if wake.is_set():
            continue
        if not ip:
            _say(st="unknown", host=host)
            await _until_wake(RETRY)
            continue
        if not home_address(ip):
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


# ---------- mDNS: WLED devices in the network (_wled._tcp) ----------
SERVICE = "_wled._tcp.local"
MDNS = ("224.0.0.251", 5353)


def query(service: str = SERVICE) -> bytes:
    """A question for the PTR records of the service, asking for answers to this socket (the "QU" bit)."""
    name = b"".join(bytes([len(p)]) + p.encode() for p in service.split(".")) + b"\0"
    return struct.pack("!HHHHHH", 0, 0, 1, 0, 0, 0) + name + struct.pack("!HH", 12, 0x8001)


def _name(data: bytes, i: int) -> tuple:
    """A DNS name at i (with compression); returns (name, the index after it)."""
    parts, end, hops = [], None, 0
    while True:
        n = data[i]
        if n & 0xC0 == 0xC0:
            if end is None:
                end = i + 2
            i = ((n & 0x3F) << 8) | data[i + 1]
            hops += 1
            if hops > 20:
                raise ValueError("loop")
            continue
        if n == 0:
            return ".".join(parts), (end if end is not None else i + 1)
        parts.append(data[i + 1:i + 1 + n].decode("utf-8", "replace"))
        i += 1 + n


def parse(data: bytes, service: str = SERVICE) -> list:
    """The devices in one mDNS answer: [{"name", "host", "ip"}] (ip empty when the answer had no address)."""
    try:
        _, flags, qd, an, ns, ar = struct.unpack("!HHHHHH", data[:12])
        if not flags & 0x8000:
            return []
        i = 12
        for _ in range(qd):
            _, i = _name(data, i)
            i += 4
        ptr, srv, a = [], {}, {}
        for _ in range(an + ns + ar):
            name, i = _name(data, i)
            kind, _, _, size = struct.unpack("!HHIH", data[i:i + 10])
            i += 10
            body = i
            i += size
            if kind == 12 and name.lower() == service:
                ptr.append(_name(data, body)[0])
            elif kind == 33:
                srv[name.lower()] = _name(data, body + 6)[0]
            elif kind == 1 and size == 4:
                a[name.lower()] = socket.inet_ntoa(data[body:body + 4])
    except (struct.error, IndexError, ValueError):
        return []
    out = []
    for inst in ptr:
        host = srv.get(inst.lower(), "")
        ip = a.get(host.lower(), "")
        if host or ip:
            out.append({"name": inst.split(".")[0][:40], "host": host.rstrip("."), "ip": ip})
    return out


def browse(secs: float = 2.0) -> list:
    """Asks the network for WLED devices for secs (blocking: run beside the loop): every device that answers, once,
    only those in the home network."""
    socks = []
    with contextlib.suppress(OSError):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
        s.bind(("", 0))
        socks.append(s)
    with contextlib.suppress(OSError):                  # answers sent to the group (not every device answers directly)
        g = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        g.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            g.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        g.bind(("", MDNS[1]))
        g.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(MDNS[0]) + socket.inet_aton("0.0.0.0"))
        socks.append(g)
    found: dict = {}
    try:
        if not socks:
            return []
        end, asked = time.monotonic() + secs, 0.0
        while (left := end - time.monotonic()) > 0:
            if time.monotonic() - asked > 0.7:            # asked again: an answer can get lost on Wi-Fi
                with contextlib.suppress(OSError):
                    socks[0].sendto(query(), MDNS)
                asked = time.monotonic()
            ready, _, _ = select.select(socks, [], [], min(left, 0.2))
            for s in ready:
                with contextlib.suppress(OSError):
                    data, (src, _) = s.recvfrom(9000)
                    for d in parse(data):
                        d["ip"] = d["ip"] or src
                        if home_address(d["ip"]):
                            found.setdefault(d["name"], d)
    finally:
        for s in socks:
            s.close()
    return sorted(found.values(), key=lambda d: d["name"])


async def find() -> list:
    """The WLED devices in the network, found in about two seconds beside the loop."""
    return await asyncio.get_running_loop().run_in_executor(None, browse, 2.0)


hub.on_change("wled", sync)
hub.on_change("wled_host", sync)
