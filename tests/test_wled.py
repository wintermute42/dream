"""The room light (#212, wled.py): DDP packets to a WLED device, the colour of the stage smoothed, the beat's pulse, the
strength, the master and its blackout; a device that does not answer slows nothing down; only Dream Control and this
Mac change it, only the stage tells the colour. The device is a fake WLED receiver – a UDP socket on 127.0.0.1 –, its
JSON API and mDNS are stand-ins: no network."""
import asyncio
import json
import socket
import struct
import time

import pytest

from test_rights import client, ctl_session, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401


@pytest.fixture
def wled(server, monkeypatch):
    """wled.py with a fresh light, a fresh wake-up (each test has its own event loop) and quick timings."""
    w = server.wled
    monkeypatch.setattr(w, "wake", asyncio.Event())
    monkeypatch.setattr(w, "status", {"st": "off"})
    monkeypatch.setattr(w, "run", {"seq": 0, "sent": 0})
    monkeypatch.setattr(w, "LAYERS", [])
    released = []
    monkeypatch.setattr(w, "release", released.append)
    monkeypatch.setattr(w, "info", lambda ip: {"leds": 30, "name": "wled-test"})
    w.released = released
    return w


@pytest.fixture
def rl(server, monkeypatch):
    """roomlight.py – the dream's colour every room-light output reads – with a fresh light."""
    monkeypatch.setattr(server.roomlight, "light", server.roomlight.Light())
    return server.roomlight


def header(p: bytes) -> tuple:
    return struct.unpack("!BBBBIH", p[:10])


# ---------- DDP ----------
def test_ddp_packets_one_frame(wled):
    rgb = bytes((10, 20, 30)) * 50
    (p,) = wled.ddp(rgb, 3)
    flags, seq, kind, dest, off, size = header(p)
    assert flags == 0x41 and seq == 3 and kind == 0x0B and dest == 1 and off == 0 and size == 150
    assert p[10:] == rgb


def test_ddp_long_chains_go_in_several_packets_the_last_one_pushes(wled):
    rgb = bytes(range(256)) * 9                          # 2304 bytes = 768 LEDs
    ps = wled.ddp(rgb, 15)
    assert len(ps) == 2
    h = [header(p) for p in ps]
    assert [x[0] for x in h] == [0x40, 0x41]              # only the last one carries the push flag
    assert [x[4] for x in h] == [0, 1440] and [x[5] for x in h] == [1440, 864]
    assert b"".join(p[10:] for p in ps) == rgb
    assert all(len(p) <= 1450 for p in ps)


# ---------- the light ----------
def frames(w, rl, secs: float, master=1.0, amt=1.0, beat=True, t0=0.0, take=None):
    """What the LED chain shows at 40 fps (as wled.session makes it); returns the bytes of the first LED of every frame."""
    out, n = [], int(secs * w.FPS)
    for i in range(n):
        now = t0 + i / w.FPS
        if take:
            take(now)
        base = rl.light.lit(now, beat)
        level = rl.light.master(now, master) * amt
        out.append(tuple(w.encode(base, w.compose(base, 3, 1 / w.FPS, now), 3, level)[:3]))
    return out


def test_the_colour_is_smoothed_not_jumped(wled, rl):
    rl.light.take({"rgb": [100, 100, 100]}, 0.0)
    frames(wled, rl, 1.0)
    rl.light.take({"rgb": [200, 100, 100]}, 1.0)
    got = frames(wled, rl, 1.5, t0=1.0)
    reds = [c[0] for c in got]
    assert reds[0] < 120 and 100 < reds[2] < 125          # the first frames after the change: only a little of the way
    assert all(a <= b for a, b in zip(reds, reds[1:]))   # then steadily on
    assert reds[-1] > 180


def test_the_average_gets_more_colourful_and_grey_stays_grey(wled, rl):
    rl.light.take({"rgb": [120, 120, 120]}, 0.0)
    assert frames(wled, rl, 0.2)[-1] == (120, 120, 120)
    rl.light = rl.Light()
    rl.light.take({"rgb": [150, 100, 50]}, 0.0)
    r, g, b = frames(wled, rl, 0.2)[-1]
    assert r > 150 and b < 50 and g == 100


def test_master_and_strength_dim_and_blackout_is_black(wled, rl):
    rl.light.take({"rgb": [200, 160, 80]}, 0.0)
    full = frames(wled, rl, 0.5)[-1]
    half = frames(wled, rl, 0.5, amt=0.5, t0=0.5)[-1]
    assert all(abs(h - f / 2) <= 1 for h, f in zip(half, full))
    dark = frames(wled, rl, 0.3, master=0.0, t0=1.0)
    assert dark[0] != (0, 0, 0)                          # the master glides like the stage's …
    assert dark[-1] == (0, 0, 0) and all(c == (0, 0, 0) for c in dark[int(0.15 * wled.FPS):])   # … and is black then
    # a flash or a beat never lights a blacked-out chain
    rl.light.take({"flash": 1, "beat": 1}, 1.3)
    assert frames(wled, rl, 0.2, master=0.0, t0=1.3)[-1] == (0, 0, 0)


def test_the_beat_pulses_and_only_while_it_comes(wled, rl):
    period = 0.5

    def beats(now):
        if abs(now / period - round(now / period)) < 0.5 / wled.FPS:
            rl.light.take({"beat": 1.0}, now)
    rl.light.take({"rgb": [200, 200, 200]}, 0.0)
    got = [c[0] for c in frames(wled, rl, 4.0, take=beats)]
    last_two = got[-2 * int(period * wled.FPS):]
    assert max(last_two) >= 195 and min(last_two) < 140   # full on the beat, clearly lower between the beats
    # with "pulse on the beat" off the light stays steady
    rl.light = rl.Light()
    rl.light.take({"rgb": [200, 200, 200]}, 0.0)
    steady = [c[0] for c in frames(wled, rl, 4.0, beat=False, take=beats)][-40:]
    assert max(steady) - min(steady) <= 1
    # the music stops: the pulse fades out, the light comes back to full
    after = [c[0] for c in frames(wled, rl, 4.0, t0=4.0)]
    assert after[-1] >= 199


def test_a_flash_brightens_towards_white_and_fades(wled, rl):
    rl.light.take({"rgb": [200, 0, 0]}, 0.0)
    frames(wled, rl, 0.5, beat=False)
    rl.light.take({"flash": 1}, 0.5)
    got = frames(wled, rl, 2.0, beat=False, t0=0.5)
    assert got[0][1] > 150 and got[0][2] > 150           # nearly white
    assert got[-1][1] < 5                                # and gone again


def test_one_source_for_every_output(rl):
    """roomlight.py is read by every room-light output: a slow lamp asking once a second sees the same smoothed colour
    as the LEDs asking 40 times a second – calm (no beat, no flash) –, and the same master."""
    shared, lone = rl.light, rl.Light()
    for light in (shared, lone):
        light.take({"rgb": [200, 40, 40]}, 0.0)
        light.colour(0.0)
        light.take({"rgb": [40, 40, 200]}, 1.0)
        light.take({"beat": 1.0, "flash": 1.0}, 1.0)
    for i in range(1, 41):                               # the LEDs, 40 frames over one second …
        lit = shared.lit(1.0 + i / 40)
        shared.master(1.0 + i / 40, 0.5)
        if i == 2:
            assert lit[1] > 100                          # (with the flash: towards white)
    calm, alone = shared.colour(2.0), lone.colour(2.0)   # … and a lamp that asks only now
    assert all(abs(a - b) < 0.01 for a, b in zip(calm, alone)), (calm, alone)
    assert calm[2] > calm[0] and shared.smooth[0] > 40   # on its way to blue, softly
    assert shared.colour(2.0) == calm                    # asking again at the same moment changes nothing
    assert shared.master(2.0, 0.5) == 0.5 and lone.master(2.0, 0.0) == 0.0


def test_odd_words_of_the_stage_are_not_taken(wled, rl):
    for bad in ({"rgb": [1, 2]}, {"rgb": ["a", 1, 2]}, {"rgb": [float("nan"), 1, 2]}, {"beat": True}, "x", None,
                {"rgb": [True, 1, 2]}):
        rl.light.take(bad, 0.0)
    assert rl.light.target is None and rl.light.pulse_of(0.0) == 0
    rl.light.take({"rgb": [999, -5, 12.5]}, 0.0)
    assert rl.light.target == (255.0, 0.0, 12.5)


def test_layers_lie_on_the_base_colour_and_the_master_acts_after_them(wled):
    """#270 hangs the dance's layers in here: each LED has its own colour, the strength and the master come last."""
    def spot(buf, dt, now):
        buf[1][:] = [255.0, 255.0, 255.0]
    wled.LAYERS.append(spot)
    base = (10.0, 20.0, 30.0)
    buf = wled.compose(base, 3, 0.025, 0.0)
    assert wled.encode(base, buf, 3, 1.0) == bytes([10, 20, 30, 255, 255, 255, 10, 20, 30])
    assert wled.encode(base, buf, 3, 0.0) == bytes(9)    # a blackout is black, whatever a layer does


# ---------- the settings and who may change them ----------
def test_the_settings_are_in_the_table_and_not_for_guests(server):
    import midi
    s = server.settings
    assert {"wled", "wled_host", "wled_amt", "wled_beat"} <= set(s.SETTINGS)
    assert not {"wled", "wled_host", "wled_amt", "wled_beat"} & s.GUEST_KEYS
    assert s.guest_changes({"wled": True, "wled_host": "192.168.1.40", "wled_amt": 0.2}) == {}
    assert "wled_amt" in midi.TARGETS and s.DEFAULT_STATE["wled"] is False
    assert "wled_amt" not in s.RESET                     # "Reset" leaves the output alone


@pytest.mark.parametrize("given,kept", [
    ("192.168.1.40", "192.168.1.40"), (" WLED-Room.local. ", "wled-room.local"), ("wled-a1b2c3", "wled-a1b2c3"),
    ("192.168.1", ""), ("192.168.1.400", ""), ("http://192.168.1.40", ""), ("192.168.1.40:80", ""), ("a b", ""),
    ("-bad.local", ""), ("x" * 300, ""), ("", "")])
def test_the_device_address_is_an_address_or_nothing(server, given, kept):
    assert server.settings.coerce("wled_host", given) == kept


@pytest.mark.parametrize("ip,ok", [("192.168.1.40", True), ("10.0.0.7", True), ("172.16.3.4", True),
                                   ("169.254.10.1", True), ("127.0.0.1", True), ("8.8.8.8", False),
                                   ("224.0.0.251", False), ("100.64.1.1", False), ("nonsense", False)])
def test_light_goes_only_to_the_home_network(server, ip, ok):
    assert server.net.home_address(ip) is ok


def stage_url(server):
    return ws_url(server, "/ctl", "local") + "?role=stage"


def test_guests_change_nothing_of_the_light_and_tell_no_colour(server, wled, rl, saved_state):
    saved_state.update(wled=False, wled_host="", wled_amt=1.0, prompt="before")
    ctl_session(server, "guest", [{"set": {"wled": True, "wled_host": "192.168.1.40", "wled_amt": 0.1, "wled_beat": False}},
                                  {"led": {"rgb": [1, 2, 3], "flash": 1}}, {"wled_find": True},
                                  {"set": {"prompt": "after"}}],
                done=lambda: server.hub.state["prompt"] == "after")
    s = server.hub.state
    assert (s["wled"], s["wled_host"], s["wled_amt"], s["wled_beat"]) == (False, "", 1.0, True)
    assert rl.light.target is None and rl.light.flash_of(time.monotonic()) == 0
    # Dream Control may switch it, but the colour is the stage's alone
    ctl_session(server, "control", [{"set": {"wled": True, "wled_host": "192.168.1.40"}}, {"led": {"rgb": [1, 2, 3]}},
                                    {"set": {"prompt": "control"}}],
                done=lambda: server.hub.state["prompt"] == "control")
    assert (s["wled"], s["wled_host"]) == (True, "192.168.1.40") and rl.light.target is None


def test_the_stage_tells_the_colour_and_hears_what_was_found(server, wled, rl, monkeypatch, saved_state):
    async def find():
        return [{"name": "wled-test", "host": "wled-test.local", "ip": "192.168.1.41"}]
    monkeypatch.setattr(wled, "find", find)
    with client(server, "local").websocket_connect(stage_url(server)) as stage:
        stage.send_text(json.dumps({"led": {"rgb": [10, 200, 30]}}))
        stage.send_text(json.dumps({"led": {"beat": 0.8}}))
        stage.send_text(json.dumps({"wled_find": True}))
        wait_until(lambda: rl.light.target == (10.0, 200.0, 30.0) and rl.light.beat == 0.8)
        for _ in range(40):
            m = stage.receive_json()
            if "found" in m.get("wled", {}):
                break
        assert m["wled"]["found"] == [{"name": "wled-test", "host": "wled-test.local", "ip": "192.168.1.41"}]


def test_a_trance_of_dreamy_eyes_flashes_the_light(server, wled, rl, monkeypatch, saved_state):
    async def mood(m):
        return None
    monkeypatch.setattr(server.windows, "windows_mood", mood)
    ctl_session(server, "eyes", [{"eyes_mood": "trance"}], done=lambda: rl.light.flash > 0)


# ---------- the sender, against a fake WLED receiver ----------
class Receiver(asyncio.DatagramProtocol):
    def __init__(self):
        self.packets = []

    def datagram_received(self, data, addr):
        self.packets.append((time.monotonic(), data))


async def receiver():
    loop = asyncio.get_running_loop()
    transport, proto = await loop.create_datagram_endpoint(Receiver, local_addr=("127.0.0.1", 0))
    return transport, proto, transport.get_extra_info("sockname")[1]


async def until(cond, secs=3.0):
    end = time.monotonic() + secs
    while not cond():
        assert time.monotonic() < end, "not in time"
        await asyncio.sleep(0.01)


def colour_of(p: bytes) -> tuple:
    return tuple(p[10:13])


def test_live_packets_carry_the_stage_colour_the_count_and_go_dark_on_blackout(server, wled, rl, monkeypatch, saved_state):
    saved_state.update(wled=True, wled_host="127.0.0.1", wled_amt=1.0, wled_beat=True, master=1.0)

    async def go():
        transport, rx, port = await receiver()
        monkeypatch.setattr(wled, "PORT", port)
        task = asyncio.create_task(wled.keep())
        try:
            await asyncio.sleep(0.2)
            assert not rx.packets and wled.status["st"] == "wait"   # no colour of the stage yet: nothing is sent
            rl.take({"rgb": [200, 120, 40]})
            await until(lambda: len(rx.packets) > 20)
            p = rx.packets[-1][1]
            assert header(p)[0] == 0x41 and header(p)[5] == 90      # 30 LEDs, as the device says
            assert all(p[10 + i * 3:13 + i * 3] == p[10:13] for i in range(30))   # one colour along the chain
            r, g, b = colour_of(p)
            assert r > g > b and r > 150
            assert wled.status == {"st": "live", "host": "127.0.0.1", "ip": "127.0.0.1", "leds": 30, "name": "wled-test"}
            t = [at for at, _ in rx.packets[-21:]]
            assert 0.3 < t[-1] - t[0] < 0.8                     # about 40 frames a second
            seqs = {header(p)[1] for _, p in rx.packets}
            assert seqs <= set(range(1, 16)) and len(seqs) > 5
            # blackout: black packets (WLED keeps showing Dream's black, not its own program)
            server.hub.state["master"] = 0.0
            await asyncio.sleep(0.3)
            n = len(rx.packets)
            await until(lambda: len(rx.packets) > n + 5)
            assert all(colour_of(p) == (0, 0, 0) for _, p in rx.packets[n:])
            # switched off: no more packets, and WLED is asked back to its own program
            server.hub.state["wled"] = False
            wled.sync()
            await until(lambda: wled.status["st"] == "off")
            await asyncio.sleep(0.1)
            n = len(rx.packets)
            await asyncio.sleep(0.2)
            assert len(rx.packets) == n
            await until(lambda: wled.released == ["127.0.0.1"])
        finally:
            task.cancel()
            transport.close()
    asyncio.run(go())


def test_when_the_stage_falls_silent_wled_goes_back_to_its_own_program(server, wled, rl, monkeypatch, saved_state):
    saved_state.update(wled=True, wled_host="127.0.0.1", master=1.0)
    monkeypatch.setattr(rl, "SILENT_AFTER", 0.3)

    async def go():
        transport, rx, port = await receiver()
        monkeypatch.setattr(wled, "PORT", port)
        task = asyncio.create_task(wled.keep())
        try:
            rl.take({"rgb": [50, 60, 70]})
            await until(lambda: len(rx.packets) > 3)
            await until(lambda: wled.status["st"] == "wait")
            await until(lambda: wled.released == ["127.0.0.1"])
            n = len(rx.packets)
            await asyncio.sleep(0.2)
            assert len(rx.packets) == n
            rl.take({"rgb": [50, 60, 70]})                 # the stage is back: so is the light
            await until(lambda: len(rx.packets) > n + 3)
        finally:
            task.cancel()
            transport.close()
    asyncio.run(go())


def test_a_device_that_does_not_answer_slows_nothing(server, wled, rl, monkeypatch, saved_state):
    """Its JSON API hangs and nobody listens on its port: the frames go out on time all the same, the loop never waits."""
    saved_state.update(wled=True, wled_host="127.0.0.1", master=1.0)
    monkeypatch.setattr(wled, "info", lambda ip: time.sleep(1.0) or {})

    async def go():
        dead = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        dead.bind(("127.0.0.1", 0))
        monkeypatch.setattr(wled, "PORT", dead.getsockname()[1])
        dead.close()                                       # nobody there any more: the port answers "unreachable"
        rl.take({"rgb": [50, 60, 70]})
        task = asyncio.create_task(wled.keep())
        lags, t = [], time.monotonic()
        try:
            while time.monotonic() - t < 1.5:              # the event loop stays free
                a = time.monotonic()
                await asyncio.sleep(0.01)
                lags.append(time.monotonic() - a - 0.01)
                rl.take({"rgb": [50, 60, 70]})
            assert max(lags) < 0.05
            assert wled.run["sent"] > 40                   # about 40 frames a second, also before the API gave up
            assert wled.status["st"] == "live" and wled.status.get("noinfo") is True
        finally:
            task.cancel()
    asyncio.run(go())


def test_no_light_to_an_address_outside_the_home_network(server, wled, monkeypatch, saved_state):
    saved_state.update(wled=True, wled_host="8.8.8.8")
    opened = []
    monkeypatch.setattr(wled, "session", lambda host, ip: opened.append(ip))

    async def go():
        task = asyncio.create_task(wled.keep())
        try:
            await until(lambda: wled.status["st"] == "public")
            assert not opened
        finally:
            task.cancel()
    asyncio.run(go())


def test_a_name_that_is_not_found_is_said_and_tried_again(server, wled, monkeypatch, saved_state):
    saved_state.update(wled=True, wled_host="wled-nowhere.local")
    asked = []

    async def resolve(host):
        asked.append(host)
        return None
    monkeypatch.setattr(server.net, "resolve", resolve)
    monkeypatch.setattr(wled, "RETRY", 0.05)

    async def go():
        task = asyncio.create_task(wled.keep())
        try:
            await until(lambda: len(asked) >= 2)
            assert wled.status == {"st": "unknown", "host": "wled-nowhere.local"}
        finally:
            task.cancel()
    asyncio.run(go())
