"""#277: devices worn on the body (wearables.py) – a StickS3 on the wrist (its raw motion into the sensor input, its
button the dance's clutch) and an ATOM Matrix as a display. The device is a fake: OSC packets built here and handed in,
the answers caught by a fake transport – and once the real sensor loop on a free port of 127.0.0.1 with a fake device's
socket. No real device, no network, no mDNS responder."""
import asyncio
import json
import math
import os
import socket
import stat
import time

import pytest
from pythonosc.osc_message import OscMessage

import sensors
import wearables
from test_rights import ctl_session, no_ghost_sockets, saved_state, wait_until  # noqa: F401

STICK, OTHER, MATRIX = "a1b2c3d4e5f6", "0f0e0d0c0b0a", "112233445566"
HOME = ("192.168.1.50", 50123)


class Wire:
    """A fake transport: what Dream sends, decoded."""

    def __init__(self):
        self.sent = []

    def sendto(self, data, addr):
        m = OscMessage(data)
        self.sent.append((addr, m.address, list(m.params)))

    def of(self, what):
        return [p for _, a, p in self.sent if a == wearables.PREFIX + what]


@pytest.fixture
def wear(monkeypatch):
    """A fresh registry feeding a fresh sensor input, answers on a fake wire."""
    sens = sensors.Sensors()
    w = wearables.Wearables(feed=lambda a, v, src, t, unit: sens.on_osc(a, v, src, now=t, gyro_unit=unit))
    w.transport, w.sens = Wire(), sens
    return w


def hello(w, id_=STICK, kind="sticks3", token="", battery=77, now=100.0, addr=HOME):
    w.on_osc(wearables.PREFIX + "hello", [id_, kind, token, battery, "1.0.0"], addr, now=now)


def press(w, want, seq, token="", id_=STICK, now=100.5, addr=HOME):
    w.on_osc(wearables.PREFIX + "clutch", [id_, token, int(want), seq], addr, now=now)


def pair(w, id_=STICK, now=100.0):
    hello(w, id_, now=now)
    assert w.allow(id_, now=now)
    token = w.transport.of("pair")[-1][0]
    hello(w, id_, token=token, now=now)
    return token


# ---------- hello, state, the "?" ----------
def test_a_hello_is_answered_with_the_clutch_and_whether_the_device_is_allowed(wear):
    hello(wear)
    assert wear.transport.sent == [(HOME, "/dream/wear/state", [0, 0, 0])]     # released, not allowed, no press yet
    wear.clutch = True
    hello(wear, now=101.0)
    assert wear.transport.of("state")[-1] == [1, 0, 0]
    [d] = wear.listing(now=101.0)
    assert (d["name"], d["kind"], d["live"], d["battery"], d["paired"], d["firmware"]) == ("StickS3 E5F6", "sticks3", True, 77, False, "1.0.0")


@pytest.mark.parametrize("args", [[], ["A1B2C3D4E5F6", "sticks3", "", 1], ["a1b2", "sticks3", "", 1], [STICK, "phone", "", 1],
                                  [STICK, "sticks3"], [7, "sticks3", "", 1]])
def test_odd_packets_are_not_taken(wear, args):
    wear.on_osc(wearables.PREFIX + "hello", args, HOME, now=1.0)
    wear.on_osc(wearables.PREFIX + "imu", args + [float("nan")] * 6, HOME, now=1.0)
    assert wear.devices == {} and wear.transport.sent == []


def test_at_most_a_few_devices_are_kept(wear):
    for i in range(20):
        hello(wear, id_=f"{i:012x}", now=1.0)
    assert len(wear.devices) == wearables.MAX_DEVICES


# ---------- the raw motion ----------
def test_the_motion_goes_into_the_sensor_input_in_its_units_and_keeps_the_devices_spacing(wear):
    hello(wear, now=10.0)
    for i in range(12):                                     # 50 a second on the device's clock, the network late at times
        wear.on_osc(wearables.PREFIX + "imu", [STICK, 5000 + 20 * i, 0.0, 0.0, 1.0, 90.0, 0.0, -45.0], HOME,
                    now=10.0 + i * 0.02, wall=1000.0 + i * 0.02 + (0.03 if i % 3 else 0.0))
    s = wear.sens
    assert s.ch["/sticks3/d4e5f6/accelerometer:2"].v == pytest.approx(wearables.G)      # g → m/s²
    m = s.motion(now=s.gyro_at)
    assert m["g"] == pytest.approx([math.radians(90), 0, math.radians(-45)], abs=1e-3)   # degrees a second → rad/s
    assert s.gyro_by == "StickS3 E5F6"
    raw = s.take_raw(now=s.gyro_at)
    gyro = [r for r in raw if r[1] == 2]
    assert len(gyro) == 12 and len(raw) == 24                                           # #196: every sample, both kinds
    ages = [r[0] for r in gyro]
    assert all(a > b for a, b in zip(ages, ages[1:]))
    assert all(b - a == pytest.approx(-0.02, abs=1e-3) for a, b in zip(ages[3:], ages[4:]))   # its own spacing, not the network's
    assert s.take_raw(now=s.gyro_at) == []                                              # taken once


def test_a_late_packet_is_dropped_and_a_restarted_device_starts_anew(wear):
    hello(wear, now=1.0)
    imu = lambda ms, x: wear.on_osc(wearables.PREFIX + "imu", [STICK, ms, 0.0, 0.0, 1.0, x, 0.0, 0.0], HOME, now=1.0, wall=50.0)
    imu(60000, 10.0)
    imu(59980, 99.0)                                          # swapped on the way: older than the last one
    assert [r[2] for r in wear.sens.take_raw(now=50.0) if r[1] == 2] == [pytest.approx(math.radians(10), abs=1e-3)]
    imu(20, 30.0)                                           # its clock began again (a restart): taken
    assert len([r for r in wear.sens.take_raw(now=50.0) if r[1] == 2]) == 1


def test_the_stick_is_a_wristband_in_the_register(server, wear, monkeypatch):
    monkeypatch.setattr(server.inputs, "sens", wear.sens)
    monkeypatch.setattr(server.inputs, "sources_told", {"msg": None})
    monkeypatch.setitem(server.hub.state, "move_mode", "dance")
    monkeypatch.setitem(server.hub.state, "move_off", "")
    monkeypatch.setattr(server.movement, "sources", server.movement.Sources())
    sent = []

    async def broadcast(msg, exclude=None, only=None):
        sent.append(msg)
    monkeypatch.setattr(server.hub, "broadcast", broadcast)
    now = time.time()
    hello(wear)
    for i in range(5):
        wear.on_osc(wearables.PREFIX + "imu", [STICK, 100 + 20 * i, 0.0, 0.0, 1.0, 200.0, 0.0, 0.0], HOME, wall=now)
    asyncio.run(server.inputs.sources_tell())
    [src] = [m for m in sent if "move" in m][-1]["move"]["sources"]
    assert (src["kind"], src["name"], src["active"]) == ("band", "StickS3 E5F6", True)


# ---------- the button: the clutch, only for a device the owner allowed ----------
def test_an_unpaired_device_never_moves_the_clutch(wear):
    hello(wear)
    press(wear, True, 1)
    press(wear, True, 2, token="0" * 32)                    # a guessed token
    assert wear.events == [] and wear.devices[STICK].refused == 2
    assert wear.transport.of("state")[-1] == [0, 0, 0]       # "not allowed": the device shows it


def test_a_press_without_a_hello_first_is_not_taken(wear):
    press(wear, True, 1)
    assert wear.events == [] and wear.transport.sent == []


def test_allowing_gives_the_device_a_token_kept_only_in_the_state_folder(wear, sandbox):
    hello(wear)
    assert wear.allow(STICK, now=100.0)
    [[token]] = wear.transport.of("pair")
    assert len(token) == 32
    path = wearables.store_file()
    assert path.startswith(sandbox["DREAM_STATE_DIR"]) and stat.S_IMODE(os.stat(path).st_mode) == 0o600
    with open(path) as f:
        assert json.load(f) == {"devices": {STICK: {"kind": "sticks3", "token": token}}}
    assert wear.listing(now=100.0)[0]["ready"] is False      # allowed, not confirmed yet …
    hello(wear, token="")                                   # … a hello without it: the token again
    assert wear.transport.of("pair")[-1] == [token]
    hello(wear, token=token)
    d = wear.listing(now=100.0)[0]
    assert (d["paired"], d["ready"]) == (True, True) and wear.transport.of("state")[-1] == [0, 1, 0]
    assert token not in json.dumps(wear.msg(7020, True, now=100.0))       # never to a page
    assert wearables.Wearables().paired == {STICK: {"kind": "sticks3", "token": token}}   # kept over a restart


def test_only_a_device_that_is_there_and_has_a_button_can_be_allowed(wear):
    assert not wear.allow(STICK, now=1.0) and not wear.allow(None, now=1.0) and not wear.allow({"x": 1}, now=1.0)
    hello(wear, now=time.monotonic() - wearables.GONE - 1)  # it said hello, but it is gone
    assert not wear.allow(STICK)
    hello(wear, id_=MATRIX, kind="matrix")
    assert not wear.allow(MATRIX, now=100.0)


def test_a_paired_press_is_a_clutch_wish_once_however_often_it_is_repeated(wear):
    token = pair(wear)
    press(wear, True, 7, token=token)
    press(wear, True, 7, token=token)                       # the same press again (no answer came back yet)
    assert wear.events == [("clutch", True, STICK)]
    press(wear, False, 8, token=token)
    assert wear.events[-1] == ("clutch", False, STICK)


def test_another_devices_id_with_the_right_token_or_a_wrong_token_is_refused(wear):
    token = pair(wear)
    hello(wear, id_=OTHER)
    press(wear, True, 1, token=token, id_=OTHER)
    press(wear, True, 1, token=token[::-1])
    assert wear.events == [] and wear.devices[OTHER].refused == 1 and wear.devices[STICK].refused == 1


def test_a_broken_or_odd_pairing_file_allows_nothing(wear, sandbox):
    path = wearables.store_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for text in ("{nonsense", json.dumps({"devices": {STICK: {"kind": "sticks3", "token": "short"}}}),
                 json.dumps({"devices": {STICK: {"kind": "matrix", "token": "a" * 32}}}), json.dumps([1, 2])):
        with open(path, "w") as f:
            f.write(text)
        w = wearables.Wearables()
        assert not w.allowed(STICK, "a" * 32) and not w.allowed(STICK, "short")


def test_revoking_takes_the_button_back(wear):
    token = pair(wear)
    assert wear.revoke(STICK) and not wear.revoke(STICK)
    press(wear, True, 9, token=token)
    assert wear.events == [] and wear.transport.of("state")[-1] == [0, 0, 0]


def test_the_press_moves_the_setting_like_every_clutch_and_every_device_hears_it(server, wear, monkeypatch, saved_state):
    monkeypatch.setattr(server.inputs, "wear", wear)
    sent = []

    async def broadcast(msg, exclude=None, only=None):
        sent.append(msg)
    monkeypatch.setattr(server.hub, "broadcast", broadcast)
    saved_state["clutch"] = False
    token = pair(wear, now=time.monotonic())
    hello(wear, id_=MATRIX, kind="matrix", now=time.monotonic(), addr=("192.168.1.51", 4000))
    press(wear, True, 3, token=token, now=time.monotonic())
    asyncio.run(server.inputs.wear_events())
    assert server.hub.state["clutch"] is True
    assert {"set": {"clutch": True}, "by": "wear"} in sent                  # the pages see who moved it
    to = lambda: {addr: p for addr, a, p in wear.transport.sent if a.endswith("state")}
    assert to() == {HOME: [1, 1, 3], ("192.168.1.51", 4000): [1, 0, 0]}     # the stick: engaged, allowed, its press taken;
    #                                                                          the display: engaged

    asyncio.run(server.hub.apply({"clutch": False}, by="midi"))              # another way of the clutch: the wrist hears it too
    assert to()[HOME] == [0, 1, 3] and to()[("192.168.1.51", 4000)] == [0, 0, 0]
    press(wear, False, 4, token=token, now=time.monotonic())                 # a wish that is already so: answered all the same
    n = len(wear.transport.sent)
    asyncio.run(server.inputs.wear_events())
    assert server.hub.state["clutch"] is False and len(wear.transport.sent) > n and to()[HOME] == [0, 1, 4]


def test_a_device_that_is_gone_is_said_so_and_the_clutch_stays(server, wear, monkeypatch, saved_state):
    monkeypatch.setattr(server.inputs, "wear", wear)
    saved_state["clutch"] = True
    pair(wear, now=10.0)
    assert wear.listing(now=10.0 + wearables.GONE - 0.1)[0]["live"] is True
    d = wear.listing(now=10.0 + wearables.GONE + 0.5)[0]
    assert (d["live"], d["paired"], d["battery"], d["seen"]) == (False, True, -1, 4)
    assert server.hub.state["clutch"] is True                                # nothing let go of it
    assert wear.listing(now=10.0 + wearables.FORGET + 100)[0]["paired"]      # an allowed one stays in the list …
    hello(wear, id_=OTHER, now=10.0)
    assert OTHER not in {x["id"] for x in wear.listing(now=10.0 + wearables.FORGET + 100)}   # … an unknown one leaves it


# ---------- the display: the clutch and the beat ----------
def test_displays_get_the_beat_not_too_often_and_nobody_else(wear):
    hello(wear, id_=MATRIX, kind="matrix", now=5.0, addr=("192.168.1.51", 4000))
    hello(wear, now=5.0)
    for t, v in ((5.01, 0.8), (5.03, 0.9), (5.2, 0.5), (5.3, "x"), (5.4, float("nan")), (5.5, -1), (5.6, 3.0)):
        wear.beat(v, now=t)
    beats = [(addr, p) for addr, a, p in wear.transport.sent if a.endswith("beat")]
    assert [p[0] for _, p in beats] == [pytest.approx(0.8), pytest.approx(0.5), 1.0]
    assert {addr for addr, _ in beats} == {("192.168.1.51", 4000)}
    assert wear.displays(now=5.6) == 1 and wear.displays(now=5.0 + wearables.GONE + 1) == 0
    wear.beat(1.0, now=5.0 + wearables.GONE + 1)                               # a display that is gone hears nothing
    assert len([1 for _, a, _ in wear.transport.sent if a.endswith("beat")]) == 3


def test_the_stage_beat_reaches_the_display(server, wear, monkeypatch, saved_state):
    monkeypatch.setattr(server.inputs, "wear", wear)
    hello(wear, id_=MATRIX, kind="matrix", now=time.monotonic())
    from test_wled import stage_url
    from test_rights import client
    with client(server, "local").websocket_connect(stage_url(server)) as stage:
        stage.send_text(json.dumps({"led": {"beat": 0.7}}))
        wait_until(lambda: wear.transport.of("beat"))
    assert wear.transport.of("beat") == [[pytest.approx(0.7)]]


# ---------- rights ----------
def test_only_the_home_network_is_heard(server, wear, monkeypatch):
    monkeypatch.setattr(server.inputs, "wear", wear)
    for ip in ("8.8.8.8", "9.9.9.9", "not-an-ip"):
        server.inputs.wear_packet((ip, 5000), wearables.PREFIX + "hello", STICK, "sticks3", "", 50, "1")
    assert wear.devices == {}
    server.inputs.wear_packet(("127.0.0.1", 5000), wearables.PREFIX + "hello", STICK, "sticks3", "", 50, "1")
    assert STICK in wear.devices


def test_guests_cannot_allow_a_device_only_the_panel_and_dream_control(server, wear, monkeypatch, saved_state):
    monkeypatch.setattr(server.inputs, "wear", wear)
    saved_state["prompt"] = "before"
    hello(wear, now=time.monotonic())
    ctl_session(server, "guest", [{"wear": {"op": "allow", "id": STICK}}, {"set": {"prompt": "guest"}}],
                done=lambda: server.hub.state["prompt"] == "guest")
    assert wear.paired == {}
    ctl_session(server, "eyes", [{"wear": {"op": "allow", "id": STICK}}], done=lambda: True)
    time.sleep(0.1)
    assert wear.paired == {}
    hello(wear, now=time.monotonic())
    ctl_session(server, "control", [{"wear": {"op": "allow", "id": STICK}}], done=lambda: STICK in wear.paired)
    ctl_session(server, "local", [{"wear": {"op": "revoke", "id": STICK}}], done=lambda: STICK not in wear.paired)


def test_the_panel_hears_the_devices_but_never_a_token_and_guests_hear_nothing(server, wear, monkeypatch):
    monkeypatch.setattr(server.inputs, "wear", wear)
    monkeypatch.setattr(server.inputs, "wear_told", {"msg": None})
    token = pair(wear, now=time.monotonic())
    from test_rights import client, ws_url
    for role, hears in (("local", True), ("guest", False)):
        with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
            got = [ws.receive_text()]
            while sum('"live"' in t for t in got) < 2:      # the greeting ends with who is connected (after the state)
                got.append(ws.receive_text())
        wears = [json.loads(t)["wear"] for t in got if '"wear"' in t]
        assert bool(wears) == hears
        assert not any(token in t for t in got)
        if hears:
            assert wears[0]["devices"][0]["id"] == STICK and wears[0]["port"] == server.inputs.SENSOR_PORT


# ---------- mDNS ----------
def test_the_port_is_announced_with_the_systems_own_responder():
    have = lambda name: "/usr/bin/" + name
    assert wearables.advert_cmd(7020, "darwin", have) == ["dns-sd", "-R", "Dream", "_dream-osc._udp", "local", "7020"]
    assert wearables.advert_cmd(7021, "linux", have) == ["avahi-publish-service", "Dream", "_dream-osc._udp", "7021"]
    assert wearables.advert_cmd(7020, "darwin", lambda name: None) is None
    assert wearables.advert_cmd(7020, "win32", have) is None


# ---------- end to end: the real sensor loop on a free port of this Mac, a fake device's socket ----------
def test_a_fake_device_over_udp_gets_its_answers(server, monkeypatch, saved_state):
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    monkeypatch.setattr(server.inputs, "SENSOR_PORT", port)
    monkeypatch.setattr(server.config, "LAN", False)                         # 127.0.0.1 only, and no mDNS announcement
    w = wearables.Wearables(feed=lambda a, v, src, t, unit: server.inputs.sens.on_osc(a, v, src, now=t, gyro_unit=unit))
    monkeypatch.setattr(server.inputs, "wear", w)
    announced = []

    async def advertise(p):
        announced.append(p)
    monkeypatch.setattr(wearables, "advertise", advertise)
    saved_state["clutch"] = False
    dev = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    dev.bind(("127.0.0.1", 0))
    dev.settimeout(2.0)

    def answer(what, want=None):
        while True:
            m = OscMessage(dev.recvfrom(2048)[0])
            if m.address == wearables.PREFIX + what and (want is None or list(m.params) == want):
                return list(m.params)

    async def run():
        loop = asyncio.create_task(server.real_loops["sensor_loop"]())
        try:
            await asyncio.sleep(0.2)
            send = lambda what, *args: dev.sendto(wearables.osc(wearables.PREFIX + what, *args), ("127.0.0.1", port))
            send("hello", STICK, "sticks3", "", 64, "1.0.0")
            assert await asyncio.to_thread(answer, "state") == [0, 0, 0]       # not allowed yet
            assert w.allow(STICK)
            token = (await asyncio.to_thread(answer, "pair"))[0]
            send("hello", STICK, "sticks3", token, 64, "1.0.0")
            assert await asyncio.to_thread(answer, "state", [0, 1, 0])
            send("clutch", STICK, token, 1, 1)
            assert await asyncio.to_thread(answer, "state", [1, 1, 1])          # engaged – said back to the wrist
            assert server.hub.state["clutch"] is True
        finally:
            loop.cancel()
            with pytest.raises(asyncio.CancelledError):
                await loop
            w.transport.close()
    try:
        asyncio.run(run())
    finally:
        dev.close()
    assert announced == []


# ---------- what the owner sees of a stick worn blind (in a band) ----------
def test_the_panel_hears_a_low_battery_and_the_last_press(wear):
    token = pair(wear, now=50.0)
    hello(wear, token=token, battery=14, now=50.0)
    d = wear.listing(now=50.0)[0]
    assert (d["battery"], d["low"], d["last"]) == (14, True, None)
    press(wear, True, 5, token=token, now=51.0)
    assert wear.listing(now=63.0)[0]["last"] == {"on": True, "ago": 12}
    hello(wear, token=token, battery=60, now=64.0)
    assert wear.listing(now=64.0)[0]["low"] is False
    assert wear.listing(now=64.0 + wearables.GONE + 1)[0]["low"] is False      # gone: no battery is known
