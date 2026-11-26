"""Devices of the home network that announce themselves over mDNS (#212, #272): the room light's WLED devices
(`_wled._tcp`) and Hue Bridges (`_hue._tcp`). One question to the multicast group, the answers of a short while –
blocking, so the callers run it beside the event loop; only answers from home-network addresses count."""
import contextlib
import select
import socket
import struct
import time

import net

GROUP = ("224.0.0.251", 5353)


def query(service: str) -> bytes:
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


def parse(data: bytes, service: str) -> list:
    """The devices of the service in one mDNS answer: [{"name", "host", "ip"}] (ip empty when the answer had none)."""
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
            if kind == 12 and name.lower() == service.lower():
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
            out.append({"name": inst[:-len(service) - 1][:40] if inst.lower().endswith("." + service.lower())
                        else inst.split(".")[0][:40], "host": host.rstrip("."), "ip": ip})
    return out


def browse(service: str, secs: float = 2.0) -> list:
    """Asks the network for devices of the service for secs (blocking: run beside the loop): every device that answers,
    once, only those in the home network."""
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
        g.bind(("", GROUP[1]))
        g.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(GROUP[0]) + socket.inet_aton("0.0.0.0"))
        socks.append(g)
    found: dict = {}
    try:
        if not socks:
            return []
        end, asked = time.monotonic() + secs, 0.0
        while (left := end - time.monotonic()) > 0:
            if time.monotonic() - asked > 0.7:            # asked again: an answer can get lost on Wi-Fi
                with contextlib.suppress(OSError):
                    socks[0].sendto(query(service), GROUP)
                asked = time.monotonic()
            ready, _, _ = select.select(socks, [], [], min(left, 0.2))
            for s in ready:
                with contextlib.suppress(OSError):
                    data, (src, _) = s.recvfrom(9000)
                    for d in parse(data, service):
                        d["ip"] = d["ip"] or src
                        if net.home_address(d["ip"]):
                            found.setdefault(d["name"], d)
    finally:
        for s in socks:
            s.close()
    return sorted(found.values(), key=lambda d: d["name"])
