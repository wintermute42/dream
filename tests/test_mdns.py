"""mDNS (mdns.py, #212, #272): the question for a service and the devices in an answer – a WLED device, a Hue Bridge.
Only packets made here: no network."""
import socket
import struct

import pytest


@pytest.fixture
def mdns(server):
    """mdns.py as the app imports it (after the server's environment is set: it reaches net.py and with it the app)."""
    import mdns
    return mdns


def dns_name(name: str) -> bytes:
    return b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\0"


def answer(service: str, instance: str, host: str, ip: str) -> bytes:
    """An answer as a device gives it: PTR to its instance (with a compression pointer to the service), SRV to its
    host, A."""
    head = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 2)
    label = instance.encode()
    ptr_data = bytes([len(label)]) + label + b"\xc0\x0c"            # the instance + the service name at offset 12
    rr_ptr = dns_name(service) + struct.pack("!HHIH", 12, 1, 120, len(ptr_data)) + ptr_data
    srv_data = struct.pack("!HHH", 0, 0, 443) + dns_name(host)
    rr_srv = dns_name(f"{instance}.{service}") + struct.pack("!HHIH", 33, 0x8001, 120, len(srv_data)) + srv_data
    rr_a = dns_name(host) + struct.pack("!HHIH", 1, 0x8001, 120, 4) + socket.inet_aton(ip)
    return head + rr_ptr + rr_srv + rr_a


WLED = answer("_wled._tcp.local", "wled-a1b2c", "wled-a1b2c.local", "192.168.1.77")
HUE = answer("_hue._tcp.local", "Hue Bridge - 0A0B0C", "001788fffe0a0b0c.local", "192.168.1.2")


@pytest.mark.parametrize("service", ["_wled._tcp.local", "_hue._tcp.local"])
def test_the_question_asks_for_the_service(mdns, service):
    q = mdns.query(service)
    assert q[:12] == struct.pack("!HHHHHH", 0, 0, 1, 0, 0, 0)
    assert q[12:] == dns_name(service) + struct.pack("!HH", 12, 0x8001)


def test_an_answer_gives_the_device(mdns):
    assert mdns.parse(WLED, "_wled._tcp.local") == [{"name": "wled-a1b2c", "host": "wled-a1b2c.local", "ip": "192.168.1.77"}]
    assert mdns.parse(HUE, "_hue._tcp.local") == [{"name": "Hue Bridge - 0A0B0C", "host": "001788fffe0a0b0c.local",
                                                   "ip": "192.168.1.2"}]


def test_an_answer_for_another_service_gives_nothing(mdns):
    assert mdns.parse(HUE, "_wled._tcp.local") == [] and mdns.parse(WLED, "_hue._tcp.local") == []


@pytest.mark.parametrize("bad", [b"", b"\x00" * 11, WLED[:40], b"\x00\x00\x84\x00\x00\x01\x00\x00\x00\x00\x00\x00\xc0\x0c",
                                 struct.pack("!HHHHHH", 0, 0, 0, 1, 0, 0) + WLED[12:]])
def test_broken_or_foreign_packets_give_nothing(mdns, bad):
    assert mdns.parse(bad, "_wled._tcp.local") == []
