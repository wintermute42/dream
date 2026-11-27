"""Hue lamps dream along (#272, hue.py): the colour conversion, the bridge's lamps and rooms, pairing by the link button,
the light under the bridge's rate limit, master and blackout, the previous state back, a bridge that is gone or slow,
the key (only in the config folder, mode 0600, never in a log or a message to a page, only to its own bridge), and that
guests change nothing. The bridge is a fake one: an https server on 127.0.0.1 with a certificate of its own – no network."""
import asyncio
import datetime as dt
import json
import math
import os
import ssl
import stat
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from test_rights import ctl_session, saved_state, wait_until  # noqa: F401

BRIDGE_ID = "001788fffe0a0b0c"
KEY = "fake-app-key-0123456789abcdefABCDEF"
L1, L2, L3 = (f"11111111-1111-4111-8111-00000000000{i}" for i in (1, 2, 3))
DEV1, DEV2 = "22222222-2222-4222-8222-000000000001", "22222222-2222-4222-8222-000000000002"
ROOM, ROOM_GL = "33333333-3333-4333-8333-000000000001", "44444444-4444-4444-8444-000000000001"
ZONE, ZONE_GL = "33333333-3333-4333-8333-000000000002", "44444444-4444-4444-8444-000000000002"


def light(lid, dev, name, on=True, bri=80.0, xy=(0.45, 0.41), mirek=None, colour=True):
    li = {"id": lid, "type": "light", "owner": {"rid": dev, "rtype": "device"}, "metadata": {"name": name},
          "on": {"on": on}, "dimming": {"brightness": bri},
          "color_temperature": {"mirek": mirek, "mirek_valid": mirek is not None}}
    if colour:
        li["color"] = {"xy": {"x": xy[0], "y": xy[1]}, "gamut_type": "C",
                       "gamut": {"red": {"x": 0.6915, "y": 0.3083}, "green": {"x": 0.17, "y": 0.7}, "blue": {"x": 0.1532, "y": 0.0475}}}
    return li


def make_cert(folder, cn):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
            .not_valid_after(now + dt.timedelta(days=2)).sign(key, hashes.SHA256()))
    c, k = os.path.join(folder, f"{cn}.crt"), os.path.join(folder, f"{cn}.key")
    open(c, "wb").write(cert.public_bytes(serialization.Encoding.PEM))
    open(k, "wb").write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()))
    return c, k


class FakeBridge:
    """A Hue Bridge as far as Dream uses it: /api/0/config, POST /api (pairing), the v2 resources light, room, zone and
    PUT light / grouped_light – everything it was asked is kept (requests: time, method, path, body, key header)."""

    def __init__(self, folder, cn=BRIDGE_ID, bridgeid=BRIDGE_ID):
        self.pressed, self.key, self.slow, self.bridgeid = False, KEY, 0.0, bridgeid
        self.requests, self.lock = [], threading.Lock()
        self.lights = {L1: light(L1, DEV1, "Signe floor"), L2: light(L2, DEV2, "Signe table", on=False, bri=30.0, mirek=366),
                       L3: light(L3, DEV2, "Plain white", colour=False)}
        self.rooms = [{"id": ROOM, "type": "room", "metadata": {"name": "Living room"},
                       "children": [{"rid": DEV1, "rtype": "device"}, {"rid": DEV2, "rtype": "device"}],
                       "services": [{"rid": ROOM_GL, "rtype": "grouped_light"}]}]
        self.zones = [{"id": ZONE, "type": "zone", "metadata": {"name": "Corner"},
                       "children": [{"rid": L1, "rtype": "light"}], "services": [{"rid": ZONE_GL, "rtype": "grouped_light"}]}]
        cert, key = make_cert(folder, cn)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        bridge = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _reply(self, code, data):
                raw = json.dumps(data).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def _take(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n)) if n else None
                with bridge.lock:
                    bridge.requests.append((time.monotonic(), self.command, self.path, body, self.headers.get("hue-application-key")))
                if bridge.slow:
                    time.sleep(bridge.slow)
                return body

            def _authorized(self):
                if self.headers.get("hue-application-key") != bridge.key:
                    self._reply(403, {"errors": [{"description": "unauthorized user"}], "data": []})
                    return False
                return True

            def do_GET(self):
                self._take()
                if self.path == "/api/0/config":
                    return self._reply(200, {"name": "Hue Bridge", "bridgeid": bridge.bridgeid.upper(), "modelid": "BSB002"})
                if not self._authorized():
                    return
                kind = self.path.rsplit("/", 1)[-1]
                data = {"light": list(bridge.lights.values()), "room": bridge.rooms, "zone": bridge.zones}.get(kind)
                self._reply(200 if data is not None else 404, {"errors": [], "data": data or []})

            def do_POST(self):
                body = self._take()
                if self.path != "/api" or not isinstance(body, dict) or "devicetype" not in body:
                    return self._reply(400, [])
                if not bridge.pressed:
                    return self._reply(200, [{"error": {"type": 101, "address": "", "description": "link button not pressed"}}])
                self._reply(200, [{"success": {"username": bridge.key, "clientkey": "C" * 32}}])

            def do_PUT(self):
                body = self._take()
                if not self._authorized():
                    return
                kind, rid = self.path.split("/")[-2:]
                if kind == "light" and rid in bridge.lights and isinstance(body, dict):
                    li = bridge.lights[rid]
                    if "on" in body:
                        li["on"] = body["on"]
                    if "dimming" in body:
                        li["dimming"] = body["dimming"]
                    if "color" in body:
                        li["color"]["xy"] = body["color"]["xy"]
                        li["color_temperature"] = {"mirek": None, "mirek_valid": False}
                    if "color_temperature" in body:
                        li["color_temperature"] = {**body["color_temperature"], "mirek_valid": True}
                self._reply(200, {"errors": [], "data": [{"rid": rid, "rtype": kind}]})

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.http.socket = ctx.wrap_socket(self.http.socket, server_side=True)
        self.port = self.http.server_address[1]
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def puts(self, path_part=""):
        with self.lock:
            return [r for r in self.requests if r[1] == "PUT" and path_part in r[2]]

    def close(self):
        self.http.shutdown()
        self.http.server_close()


@pytest.fixture
def fake(tmp_path):
    b = FakeBridge(str(tmp_path))
    yield b
    b.close()


@pytest.fixture
def rl(server, monkeypatch):
    monkeypatch.setattr(server.roomlight, "light", server.roomlight.Light())
    return server.roomlight


@pytest.fixture
def hue(server, monkeypatch, fake):
    """hue.py with a fresh state (each test has its own event loop), talking to the fake bridge, and every message to a
    page caught (a page with full rights is connected)."""
    h = server.hue
    monkeypatch.setattr(h, "wake", asyncio.Event())
    monkeypatch.setattr(h, "status", {"st": "off"})
    monkeypatch.setattr(h, "bridge", {})
    monkeypatch.setattr(h, "pairing", {"task": None, "error": ""})
    monkeypatch.setattr(h, "sender", h.Sender())
    monkeypatch.setattr(h, "PORT", fake.port)
    monkeypatch.setattr(h, "PAIR_EVERY", 0.05)
    said = []
    monkeypatch.setattr(server.hue.outbox, "post", lambda sock, text: said.append((sock, text)) or True)
    monkeypatch.setitem(server.hub.roles, "panel", "control")
    monkeypatch.setitem(server.hub.roles, "guest-page", "guest")
    h.said = said
    return h


async def until(cond, secs=4.0):
    end = time.monotonic() + secs
    while not cond():
        assert time.monotonic() < end, "not in time"
        await asyncio.sleep(0.01)


def run(hue, go):
    """go(task) with hue.keep() running beside it."""
    async def main():
        task = asyncio.create_task(hue.keep())
        try:
            await go()
        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
    asyncio.run(main())


# ---------- colour ----------
def test_white_is_the_white_point_and_black_has_no_colour(server):
    h = server.hue
    x, y = h.xy_of((255, 255, 255))
    assert abs(x - 0.3127) < 0.002 and abs(y - 0.329) < 0.002
    assert h.xy_of((0, 0, 0)) is None


def test_colours_stay_inside_the_lamps_gamut(server):
    h = server.hue
    for gamut in h.GAMUTS.values():
        for rgb in ((255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 0, 255), (0, 255, 255), (255, 200, 0), (40, 60, 200)):
            p = h.xy_of(rgb, gamut)
            assert h.into_gamut(p, gamut) == p or math.dist(h.into_gamut(p, gamut), p) < 1e-4, (rgb, p)
    # a colour outside the triangle lands on its nearest edge; one inside stays as it is
    c = h.GAMUTS["C"]
    out = h.into_gamut((0.1, 0.85), c)
    assert math.dist(out, c[1]) < 1e-9                   # beyond the green corner: the corner itself
    edge = h.into_gamut((0.45, 0.6), c)                  # beyond the edge red–green: on it
    assert abs(h._cross(c[0], c[1], edge)) < 1e-9 and math.dist(edge, (0.45, 0.6)) < 0.15
    assert h.into_gamut((0.33, 0.33), c) == (0.33, 0.33)
    r = h.xy_of((255, 0, 0))
    assert r[0] > 0.6 and r[1] < 0.35                    # red stays red


def test_brightness_follows_the_picture_the_strength_and_the_master(server):
    h = server.hue
    assert h.want_of((255, 0, 0), 1.0, h.GAMUTS["C"])["bri"] == 100
    assert h.want_of((255, 0, 0), 0.5, h.GAMUTS["C"])["bri"] == 50
    assert h.want_of((5, 5, 5), 1.0, h.GAMUTS["C"])["bri"] == h.MIN_BRI      # a dark picture dims, never off
    assert h.want_of((255, 255, 255), 0.0, None) == {"on": False}           # the blackout is off
    assert h.want_of((255, 255, 255), 1.0, None)["xy"] is None              # a lamp without colour: brightness only
    assert h.body_of({"on": True, "bri": 40.0, "xy": (0.3, 0.3)}, 1000) == {
        "on": {"on": True}, "dynamics": {"duration": 1000}, "dimming": {"brightness": 40.0}, "color": {"xy": {"x": 0.3, "y": 0.3}}}


def test_small_steps_are_left_out(server):
    h = server.hue
    a = {"on": True, "bri": 50.0, "xy": (0.3, 0.3)}
    assert not h.differs(a, {"on": True, "bri": 50.5, "xy": (0.301, 0.3)})
    assert h.differs(a, {"on": True, "bri": 52.0, "xy": (0.3, 0.3)}) and h.differs(a, {"on": True, "bri": 50.0, "xy": (0.31, 0.3)})
    assert h.differs(a, {"on": False}) and h.differs(None, a)


# ---------- lamps and rooms ----------
def test_the_catalogue_knows_lamps_rooms_and_zones(server, fake):
    h = server.hue
    items, lamps = h.catalogue(list(fake.lights.values()), fake.rooms, fake.zones)
    assert set(items) == {"l:" + L1, "l:" + L2, "l:" + L3, "g:" + ROOM, "g:" + ZONE}
    assert items["g:" + ROOM]["lights"] == [L1, L2, L3] and items["g:" + ROOM]["group"] == ROOM_GL
    assert items["g:" + ZONE]["lights"] == [L1] and items["g:" + ZONE]["kind"] == "zone"
    assert items["l:" + L3]["colour"] is False and lamps[L3]["gamut"] is None
    assert lamps[L2]["state"] == {"on": False, "bri": 30.0, "xy": None, "mirek": 366}   # a white, not a colour
    assert lamps[L1]["state"] == {"on": True, "bri": 80.0, "xy": (0.45, 0.41), "mirek": None}


def test_rooms_go_lamp_by_lamp_while_the_budget_holds(server, fake, monkeypatch):
    h = server.hue
    items, lamps = h.catalogue(list(fake.lights.values()), fake.rooms, fake.zones)
    p = h.plan(["g:" + ROOM, "l:" + L1], items, lamps)
    assert [(t[0], t[1]) for t in p] == [("light", L1), ("light", L2), ("light", L3)]
    monkeypatch.setattr(h, "LAMPS_PER_SEC", 2)            # more lamps than the bridge takes a second: the room as a room
    p = h.plan(["g:" + ROOM, "g:" + ZONE], items, lamps)
    assert [(t[0], t[1]) for t in p] == [("grouped_light", ROOM_GL), ("grouped_light", ZONE_GL)]
    assert h.plan(["l:00000000-0000-4000-8000-000000000000", "nonsense"], items, lamps) == []


def test_the_choice_is_ids_or_nothing(server):
    c = server.settings.coerce
    assert c("hue_lamps_sel", f"l:{L1}+g:{ROOM.upper()}+l:{L1}+x:{L2}+<script>") == f"l:{L1}+g:{ROOM}"
    s = server.settings
    keys = {"hue_lamps", "hue_bridge", "hue_lamps_amt", "hue_lamps_sel"}
    assert keys <= set(s.SETTINGS) and not keys & s.GUEST_KEYS and not keys & set(s.RESET)
    assert "hue_lamps_amt" in s.TARGETS and s.DEFAULT_STATE["hue_lamps"] is False
    assert c("hue_bridge", "192.168.1.2") == "192.168.1.2" and c("hue_bridge", "https://192.168.1.2") == ""


# ---------- the key ----------
def test_the_key_lives_only_in_the_config_folder_with_mode_0600(server, sandbox):
    h = server.hue
    h.save_key(BRIDGE_ID, KEY, "C" * 32)
    path = h.key_file()
    assert os.path.dirname(path) == sandbox["DREAM_CONFIG_DIR"]
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert h.load_key()["key"] == KEY
    h.save_key(BRIDGE_ID, "another-key")                  # written anew: still 0600, nothing left beside it
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600 and os.listdir(sandbox["DREAM_CONFIG_DIR"]) == ["hue.json"]
    h.forget_key()
    assert h.load_key() is None and not os.path.exists(path)


def test_nothing_goes_to_an_address_outside_the_home_network(server):
    with pytest.raises(server.hue.Refused):
        server.hue.call("8.8.8.8", "GET", "/api/0/config")


# ---------- pairing ----------
def test_pairing_without_the_button_says_so_and_keeps_nothing(server, hue, fake, saved_state, monkeypatch, capsys):
    saved_state.update(hue_bridge="127.0.0.1", hue_lamps=False)
    monkeypatch.setattr(hue, "PAIR_SECS", 0.4)

    async def go():
        await until(lambda: hue.status.get("st") == "unpaired")
        assert hue.status == {"st": "unpaired", "host": "127.0.0.1", "name": "Hue Bridge", "paired": False}
        await hue.pair()
        await until(lambda: hue.status.get("st") == "unpaired" and hue.status.get("error"))
    run(hue, go)
    assert hue.status["error"] == "nobutton"
    assert any(json.loads(t)["hue"].get("st") == "pairing" and "left" in json.loads(t)["hue"] for _, t in hue.said)
    assert hue.load_key() is None
    posts = [r for r in fake.requests if r[1] == "POST"]
    assert len(posts) >= 3 and all(r[3] == {"devicetype": "dream#mac", "generateclientkey": True} for r in posts)


def test_pairing_with_the_button_keeps_the_key_and_lists_the_lamps(server, hue, fake, saved_state, capsys):
    saved_state.update(hue_bridge="127.0.0.1", hue_lamps=False)

    async def go():
        await until(lambda: hue.status.get("st") == "unpaired")
        task = asyncio.create_task(hue.pair())
        await until(lambda: hue.status.get("st") == "pairing")
        fake.pressed = True                                # the owner presses the link button
        await task
        await until(lambda: hue.status.get("st") == "ready")
    run(hue, go)
    assert hue.load_key()["key"] == KEY and hue.load_key()["bridge"] == BRIDGE_ID
    assert stat.S_IMODE(os.stat(hue.key_file()).st_mode) == 0o600
    st = hue.status
    assert st["paired"] is True and st["name"] == "Hue Bridge"
    assert [(x["kind"], x["name"]) for x in st["lamps"]] == [("room", "Living room"), ("zone", "Corner"), ("light", "Plain white"),
                                                            ("light", "Signe floor"), ("light", "Signe table")]
    assert all(set(x) == {"id", "name", "kind", "colour"} for x in st["lamps"])
    out = capsys.readouterr()
    assert KEY not in out.out + out.err                   # never in a log
    assert all(KEY not in t for _, t in hue.said)         # never in a message to a page
    assert {s for s, _ in hue.said} == {"panel"}          # and only pages that may change it hear of the bridge


def test_the_key_goes_only_to_its_own_bridge(server, hue, saved_state, tmp_path, monkeypatch):
    """Another device at the bridge's address that claims the bridge's id – but its certificate is not the bridge's: it
    never gets the key."""
    impostor = FakeBridge(str(tmp_path), cn="0000000000000000")
    monkeypatch.setattr(hue, "PORT", impostor.port)
    hue.save_key(BRIDGE_ID, KEY)
    saved_state.update(hue_bridge="127.0.0.1", hue_lamps=True, hue_lamps_sel="l:" + L1)
    try:
        async def go():
            await until(lambda: hue.status.get("st") == "cert")
        run(hue, go)
        assert impostor.requests and all(r[4] is None for r in impostor.requests)   # asked who it is – never with the key
    finally:
        impostor.close()


def test_a_key_the_bridge_no_longer_knows_is_forgotten(server, hue, fake, saved_state):
    hue.save_key(BRIDGE_ID, "an-old-key")
    saved_state.update(hue_bridge="127.0.0.1")

    async def go():
        await until(lambda: hue.status.get("st") == "unpaired" and hue.status.get("error") == "revoked")
    run(hue, go)
    assert hue.load_key() is None


# ---------- the light ----------
def live(hue, fake, rl, saved_state, monkeypatch, **state):
    hue.save_key(BRIDGE_ID, KEY)
    monkeypatch.setattr(rl, "SILENT_AFTER", 1e9)
    saved_state.update({"hue_bridge": "127.0.0.1", "hue_lamps": True, "hue_lamps_amt": 1.0, "master": 1.0,
                        "hue_lamps_sel": f"l:{L1}+l:{L2}", **state})
    rl.take({"rgb": [220, 40, 40]})


def test_the_lamps_take_the_dream_colour_softly_and_at_most_once_a_second(server, hue, fake, rl, saved_state, monkeypatch):
    live(hue, fake, rl, saved_state, monkeypatch)

    async def go():
        await until(lambda: hue.status.get("st") == "live")
        assert hue.status["n"] == 2
        await until(lambda: len(fake.puts(L1)) >= 1 and len(fake.puts(L2)) >= 1)
        for i in range(30):                                # the picture keeps changing, 3 s long
            rl.take({"rgb": [220 - i * 6, 40 + i * 6, 40]})
            await asyncio.sleep(0.1)
    run(hue, go)
    first = fake.puts(L1)[0][3]
    assert first["on"] == {"on": True} and first["dynamics"]["duration"] == hue.GLIDE_MS
    x, y = first["color"]["xy"]["x"], first["color"]["xy"]["y"]
    assert x > 0.55 and y < 0.36                           # red
    for lid in (L1, L2):
        t = [r[0] for r in fake.puts(lid)]
        assert len(t) >= 3 and all(b - a >= 0.95 for a, b in zip(t, t[1:])), t   # at most one change a second per lamp
    assert fake.puts(L3) == []                             # a lamp not chosen is never touched
    every = sorted(r[0] for r in fake.puts())
    assert all(every[i + 10] - every[i] >= 0.95 for i in range(len(every) - 10))   # never more than ten a second
    last = fake.lights[L1]["color"]["xy"]
    assert last["y"] > y                                   # it went on towards green


def test_a_room_is_lit_lamp_by_lamp_and_as_a_room_when_too_many(server, hue, fake, rl, saved_state, monkeypatch):
    live(hue, fake, rl, saved_state, monkeypatch, hue_lamps_sel="g:" + ROOM)
    monkeypatch.setattr(hue, "LAMPS_PER_SEC", 2)

    async def go():
        for i in range(30):
            rl.take({"rgb": [220 - i * 6, 40 + i * 6, 40]})
            await asyncio.sleep(0.1)
    run(hue, go)
    assert len(fake.puts(ROOM_GL)) >= 2
    t = [r[0] for r in fake.puts("grouped_light")]
    assert all(b - a >= 0.95 for a, b in zip(t, t[1:]))     # a room: one command a second
    assert fake.puts("/light/") == [] or all(r[3].get("on") is not None for r in fake.puts("/light/"))


def test_blackout_switches_the_lamps_off_at_once_and_master_dims(server, hue, fake, rl, saved_state, monkeypatch):
    live(hue, fake, rl, saved_state, monkeypatch, hue_lamps_sel="l:" + L1)

    async def go():
        await until(lambda: len(fake.puts(L1)) >= 1)
        await asyncio.sleep(1.2)
        server.hub.state["master"] = 0.5
        rl.take({"rgb": [220, 40, 41]})
        await until(lambda: fake.lights[L1]["dimming"]["brightness"] < 60)
        t0 = time.monotonic()
        server.hub.state["master"] = 0.0                   # blackout
        await until(lambda: fake.lights[L1]["on"] == {"on": False}, secs=1.0)
        assert time.monotonic() - t0 < 0.6
        n = len(fake.puts(L1))
        await asyncio.sleep(1.3)
        assert len(fake.puts(L1)) == n                     # dark is dark: nothing more to say
        server.hub.state["master"] = 1.0                   # and back
        await until(lambda: fake.lights[L1]["on"] == {"on": True}, secs=1.0)
    run(hue, go)
    off = [r[3] for r in fake.puts(L1) if r[3]["on"] == {"on": False}]
    assert off and off[0]["dynamics"]["duration"] == hue.SOFT_MS


@pytest.mark.parametrize("end", ["switch", "silent", "unchosen", "stop", "unpair"])
def test_after_the_end_the_lamps_get_their_previous_state_back(server, hue, fake, rl, saved_state, monkeypatch, end):
    live(hue, fake, rl, saved_state, monkeypatch)
    before = {lid: json.loads(json.dumps(fake.lights[lid])) for lid in (L1, L2)}

    async def go():
        await until(lambda: len(fake.puts(L1)) >= 1 and len(fake.puts(L2)) >= 1)
        assert fake.lights[L2]["on"] == {"on": True}       # the lamp that was off dreams along too
        if end == "switch":
            server.hub.state["hue_lamps"] = False
        elif end == "silent":
            monkeypatch.setattr(rl, "SILENT_AFTER", 0.0)
        elif end == "unchosen":
            server.hub.state["hue_lamps_sel"] = ""
        elif end == "unpair":
            hue.unpair()
        else:
            hue.stop()                                     # Dream stops: at once, before the loop ends
        await until(lambda: not hue.sender.before)
        if end == "unpair":
            await until(lambda: hue.status.get("st") == "unpaired")
    run(hue, go)
    for lid in (L1, L2):
        got, was = fake.lights[lid], before[lid]
        assert got["on"] == was["on"] and got["dimming"] == was["dimming"], lid
    assert fake.lights[L1]["color"]["xy"] == before[L1]["color"]["xy"]
    assert fake.lights[L2]["color_temperature"]["mirek"] == 366       # its white came back, not a colour
    if end == "unpair":
        assert hue.load_key() is None and hue.status["paired"] is False
    elif end != "stop":
        assert hue.status["st"] in ("ready", "wait")
    assert all(KEY not in t for _, t in hue.said)          # the key: never in a message to a page


def test_a_bridge_that_is_slow_or_gone_slows_nothing(server, hue, fake, rl, saved_state, monkeypatch):
    live(hue, fake, rl, saved_state, monkeypatch)
    monkeypatch.setattr(hue, "TIMEOUT", 0.3)
    monkeypatch.setattr(hue, "RETRY", 0.3)
    monkeypatch.setattr(hue, "RETRY_MAX", 1.5)

    async def go():
        await until(lambda: len(fake.puts(L1)) >= 1)
        fake.slow = 1.0                                    # the bridge hangs
        lags, t = [], time.monotonic()
        while time.monotonic() - t < 3.0:                  # the event loop stays free all the while
            a = time.monotonic()
            await asyncio.sleep(0.01)
            lags.append(time.monotonic() - a - 0.01)
            rl.take({"rgb": [40, 40, 220 - int((time.monotonic() - t) * 50)]})
        assert max(lags) < 0.05
        assert hue.sender.inflight <= hue.IN_FLIGHT
        n = len(fake.requests)
        await until(lambda: hue.status.get("st") == "down", secs=4.0)
        assert len(fake.requests) - n < 10                 # asked ever more rarely, not hammered
        fake.slow = 0.0                                    # back
        await until(lambda: hue.status.get("st") == "live", secs=hue.RETRY_MAX + 3)
    run(hue, go)


# ---------- rights ----------
def test_guests_change_nothing_of_the_lamps(server, saved_state, monkeypatch):
    asked = []

    async def pair():
        asked.append("pair")

    def unpair():
        asked.append("unpair")

    async def find():
        asked.append("find")
        return []
    monkeypatch.setattr(server.hue, "pair", pair)
    monkeypatch.setattr(server.hue, "unpair", unpair)
    monkeypatch.setattr(server.hue, "find", find)
    saved_state.update(hue_lamps=False, hue_bridge="", hue_lamps_amt=1.0, hue_lamps_sel="", prompt="before")
    ctl_session(server, "guest", [{"set": {"hue_lamps": True, "hue_bridge": "192.168.1.2", "hue_lamps_amt": 0.1,
                                           "hue_lamps_sel": "l:" + L1}},
                                  {"hue_pair": True}, {"hue_unpair": True}, {"hue_find": True}, {"set": {"prompt": "after"}}],
                done=lambda: server.hub.state["prompt"] == "after")
    s = server.hub.state
    assert (s["hue_lamps"], s["hue_bridge"], s["hue_lamps_amt"], s["hue_lamps_sel"]) == (False, "", 1.0, "")
    assert asked == []
    ctl_session(server, "control", [{"hue_pair": True}, {"hue_find": True}], done=lambda: set(asked) == {"pair", "find"})


def test_a_guest_page_hears_nothing_of_the_bridge(server, saved_state):
    first = []

    def collect(role):
        from test_rights import client, ws_url
        with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
            for _ in range(12):
                m = ws.receive_json()
                first.append((role, m))
                if "state" in m:
                    break
            if role != "guest":
                for _ in range(4):
                    m = ws.receive_json()
                    first.append((role, m))
                    if "hue" in m:
                        break
    collect("guest")
    collect("control")
    assert not any("hue" in m for r, m in first if r == "guest")
    assert any("hue" in m for r, m in first if r == "control")
