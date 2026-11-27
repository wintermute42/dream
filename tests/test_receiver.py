"""#278: the USB receiver (receiver.py) – an AtomS3 Lite that brings the StickS3's packets by radio over its USB serial
line. The receiver is a fake: a pty whose other end the test writes the receiver's lines into and reads Dream's lines
from. No real device, no USB port, no radio, no network."""
import asyncio
import os
import select
import subprocess
import time
import tty

import pytest
from pythonosc.osc_message import OscMessage

import receiver
import sensors
import wearables
from test_rights import saved_state  # noqa: F401

STICK, OTHER = "a1b2c3d4e5f6", "0f0e0d0c0b0a"
RX = "c0ffee123456"


@pytest.fixture
def wear():
    sens = sensors.Sensors()
    w = wearables.Wearables(feed=lambda a, v, src, t, unit: sens.on_osc(a, v, src, now=t, gyro_unit=unit))
    w.sens = sens
    w.transport = Udp()
    return w


class Udp:
    """The sensor port's transport: what Dream sends over the Wi-Fi."""

    def __init__(self):
        self.sent = []

    def sendto(self, data, addr):
        m = OscMessage(data)
        self.sent.append((addr, m.address, list(m.params)))


class Fake:
    """The receiver's end of the line: writes its lines, reads Dream's."""

    def __init__(self):
        self.master, self.slave = os.openpty()          # the slave stays open here too: a pty without one is hung up
        tty.setraw(self.slave)                           # a real receiver echoes nothing back
        self.path = os.ttyname(self.slave)
        self.got = b""

    def say(self, *lines):
        os.write(self.master, "".join(line + "\n" for line in lines).encode())

    def heard(self, wait=0.15) -> list:
        """Dream's lines since the last call (Dream writes at once; nothing for a while: that was all)."""
        until = time.monotonic() + wait
        while time.monotonic() < until:
            r, _, _ = select.select([self.master], [], [], 0.02)
            if not r:
                continue
            try:
                self.got += os.read(self.master, 65536)
            except OSError:
                break
            until = min(until, time.monotonic() + 0.03)
        *lines, self.got = self.got.split(b"\n")
        return [x.decode().strip() for x in lines]

    def close(self):
        os.close(self.master)
        os.close(self.slave)


def osc_of(line):
    """A T line of Dream: (mac, address, args)."""
    _, mac, data = line.split(" ")
    m = OscMessage(bytes.fromhex(data))
    return mac, m.address, list(m.params)


def hline(peers="-", channel=1, pairing=0, id_=RX):
    return f"H 1 {id_} 1.0.0 {channel} {pairing} {peers}"


def pline(packet, mac=STICK):
    return f"P {mac} {packet.hex()}"


def hello(id_=STICK, token="", battery=70):
    return wearables.osc(wearables.PREFIX + "hello", id_, "sticks3", token, battery, "1.1.0")


@pytest.fixture
def fake():
    f = Fake()
    yield f
    f.close()


@pytest.fixture
def rx(fake, wear):
    """A receiver Dream opened on the fake's line (no thread: the test hands its lines in)."""
    r = receiver.Receiver(fake.path, receiver.open_port(fake.path), wear, loop=None)
    receiver.links[fake.path] = r
    yield r
    r.close()
    receiver.links.clear()


def feed(r, *lines, now=100.0):
    r.feed("".join(x + "\n" for x in lines).encode(), now, 1000.0 + now)


# ---------- who it is ----------
def test_its_h_line_says_who_it_is_and_nothing_is_taken_before_it(rx, wear, fake):
    feed(rx, pline(hello()), "B")                                  # before it said who it is: nothing
    assert wear.devices == {} and wear.events == [] and rx.id is None
    feed(rx, hline(f"{STICK},{OTHER}*", channel=6, pairing=21))
    assert (rx.id, rx.channel, rx.peers, rx.firmware) == (RX, 6, {STICK: False, OTHER: True}, "1.0.0")
    [d] = receiver.listing(now=100.0)
    assert d == {"id": RX, "name": "AtomS3 receiver 3456", "live": True, "channel": 6, "pairing": 21, "peers": 2,
                 "sticks": [], "firmware": "1.0.0", "led": "r"}
    assert fake.path not in str(d)                                 # never a port's path to a page


@pytest.mark.parametrize("line", ["H 2 c0ffee123456 1 1 0 -", "H 1 C0FFEE123456 1 1 0 -", "H 1 c0ffee123456 1 14 0 -",
                                  "H 1 c0ffee123456 1 1 x -", "H 1 c0ffee123456 1 1 0 a1b2", "H 1 c0ffee123456 1 1 0",
                                  "\xff\xfe", "x" * 2000])
def test_an_odd_h_line_is_not_taken(rx, line):
    rx.feed(line.encode("latin-1") + b"\n", 1.0, 1.0)
    assert rx.id is None


# ---------- packets: only paired sticks, only their own ----------
def test_a_paired_sticks_motion_goes_into_the_one_path_of_the_worn_devices(rx, wear):
    feed(rx, hline(STICK), pline(hello()))
    dev = wear.devices[STICK]
    assert dev.via is rx and dev.addr == ("esp-now", STICK)
    for i in range(10):
        imu = wearables.osc(wearables.PREFIX + "imu", STICK, 1000 + 20 * i, 0.0, 0.0, 1.0, 90.0, 0.0, 0.0)
        feed(rx, pline(imu), now=100.0 + 0.02 * i)
    assert wear.sens.gyro_by == "StickS3 E5F6"
    assert wear.listing(now=100.2)[0]["link"] == "radio"


def test_a_stick_not_paired_with_it_or_one_naming_another_is_refused(rx, wear):
    feed(rx, hline(STICK))
    feed(rx, pline(hello(OTHER), mac=OTHER))                       # not on its list
    feed(rx, pline(hello(OTHER), mac=STICK))                       # a paired stick that names another
    feed(rx, pline(b"\x00\x01broken", mac=STICK), f"P {STICK} zz", f"P {STICK.upper()} {hello().hex()}")
    assert wear.devices == {}


def test_a_stick_paired_by_the_button_is_allowed_at_its_first_hello_and_dream_says_it_took_it(rx, wear, fake):
    feed(rx, hline(f"{STICK}*"), pline(hello()))
    assert STICK in wear.paired
    lines = fake.heard()
    pair = [osc_of(x) for x in lines if x.startswith("T ") and osc_of(x)[1].endswith("/pair")]
    assert len(pair) == 1 and pair[0][0] == STICK
    token = pair[0][2][0]
    assert f"K {STICK}" in lines
    feed(rx, pline(hello(token=token)))                            # K once a second at most, until its H says so
    assert f"K {STICK}" not in fake.heard()
    feed(rx, hline(STICK), pline(hello(token=token)), now=102.0)
    assert not any(x.startswith("K ") for x in fake.heard()) and wear.paired[STICK]["token"] == token   # no new token
    # the clutch by radio with that token
    feed(rx, pline(wearables.osc(wearables.PREFIX + "clutch", STICK, token, 1, 4)), now=102.5)
    assert wear.events == [("clutch", True, STICK)]


def test_a_stick_that_was_on_the_list_before_is_not_allowed_by_itself(rx, wear, fake):
    feed(rx, hline(STICK), pline(hello()))                         # paired long ago (no "*"), never allowed in the panel
    assert wear.paired == {} and not any(x.startswith("K ") for x in fake.heard())
    feed(rx, pline(wearables.osc(wearables.PREFIX + "clutch", STICK, "", 1, 1)))
    assert wear.events == [] and wear.devices[STICK].refused == 1
    [state] = [osc_of(x) for x in fake.heard() if x.startswith("T ")]
    assert state == (STICK, "/dream/wear/state", [0, 0, 0])        # "not allowed": the stick shows it


def test_revoked_it_stays_revoked(rx, wear, fake):
    feed(rx, hline(f"{STICK}*"), pline(hello()))
    feed(rx, hline(STICK), now=101.0)                              # the receiver took the K
    assert wear.revoke(STICK)
    feed(rx, pline(hello()), now=102.0)
    assert STICK not in wear.paired


def test_its_second_button_is_an_ordinary_sensor_button(rx, wear):
    got = []
    rx.other = lambda address, args, src: got.append((address, args, src))
    feed(rx, hline(STICK), pline(hello()))
    feed(rx, pline(wearables.osc("/sticks3/d4e5f6/button", 1)), pline(wearables.osc("/sticks3/000000/button", 1)),
         pline(wearables.osc("/elsewhere", 1)))
    assert got == [("/sticks3/d4e5f6/button", [1], "StickS3 E5F6")]


# ---------- the receiver's button and LED ----------
def test_its_button_turns_the_clutch_the_other_way(server, rx, wear, monkeypatch, saved_state):
    monkeypatch.setattr(server.inputs, "wear", wear)
    saved_state["clutch"] = False
    feed(rx, hline(), "B")
    asyncio.run(server.inputs.wear_events())
    assert server.hub.state["clutch"] is True
    feed(rx, "B", "B")
    asyncio.run(server.inputs.wear_events())
    assert server.hub.state["clutch"] is True                      # twice: back and forth again


def test_the_led_green_blue_red_and_only_while_the_receiver_works(rx, wear, fake):
    feed(rx, hline(STICK))
    receiver.tick(False, now=100.0)
    assert fake.heard() == ["L r"]                                 # no wristband
    feed(rx, pline(hello()), now=100.5)
    fake.heard()
    receiver.tick(False, now=100.6)
    assert fake.heard() == ["L b"]                                 # there, released
    receiver.tick(True, now=100.7)
    assert fake.heard() == ["L g"]                                 # there, engaged
    receiver.tick(True, now=100.8)
    assert fake.heard() == []                                      # nothing new …
    receiver.tick(True, now=101.8)
    assert fake.heard() == ["L g"]                                 # … but once a second all the same: Dream listens
    receiver.tick(True, now=100.5 + wearables.GONE + 0.1)
    assert fake.heard() == ["L r"]                                 # the stick is gone
    receiver.tick(True, now=100.0 + receiver.SILENT + 1)
    assert fake.heard() == []                                      # the receiver itself fell silent: nothing to it


def test_dream_tells_the_receiver_its_channel(rx, fake, monkeypatch):
    monkeypatch.setenv("DREAM_ESPNOW_CHANNEL", "11")
    feed(rx, hline(channel=1))
    receiver.tick(False, now=100.0)
    assert "C 11" in fake.heard()
    receiver.tick(False, now=101.0)
    assert "C 11" not in fake.heard()                              # not again at once
    for bad in ("0", "14", "x"):
        monkeypatch.setenv("DREAM_ESPNOW_CHANNEL", bad)
        assert receiver.channel() == 1


def test_the_panel_opens_its_pairing_window(server, rx, fake, monkeypatch):
    feed(rx, hline())
    fake.heard()
    server.inputs.wear_op({"op": "pairing", "id": RX})
    assert fake.heard() == ["W"]
    server.inputs.wear_op({"op": "pairing", "id": "000000000000"})
    assert fake.heard() == []
    assert "receivers" in server.inputs.wear_msg()["wear"]


# ---------- the delay ----------
def test_the_delay_is_half_the_way_there_and_back(rx, wear, fake):
    feed(rx, hline(STICK), pline(hello()))
    fake.heard()
    for k, rtt in enumerate((0.008, 0.006, 0.030)):
        t = 101.0 + k
        wear.ping_all(now=t)
        [(mac, address, [n])] = [osc_of(x) for x in fake.heard() if x.startswith("T ")]
        assert (mac, address) == (STICK, "/dream/wear/ping")
        feed(rx, pline(wearables.osc(wearables.PREFIX + "pong", STICK, n)), now=t + rtt)
        feed(rx, pline(hello()), now=t + rtt)
        fake.heard()
    assert wear.listing(now=103.1)[0]["latency"] == pytest.approx(4.0)   # the median of 6, 8, 30 ms there and back
    feed(rx, pline(wearables.osc(wearables.PREFIX + "pong", STICK, 999)), now=103.2)   # one never sent: nothing
    assert wear.listing(now=103.2)[0]["latency"] == pytest.approx(4.0)


def test_a_device_on_the_wifi_has_its_delay_too_and_none_without_pongs(wear):
    wear.on_osc(wearables.PREFIX + "hello", [STICK, "sticks3", "", 50, "1.0.0"], ("192.168.1.50", 4000), now=10.0)
    assert wear.listing(now=10.0)[0]["latency"] is None and wear.listing(now=10.0)[0]["link"] == "wifi"
    wear.ping_all(now=10.0)
    [(addr, _, [n])] = [x for x in wear.transport.sent if x[1].endswith("/ping")]
    wear.on_osc(wearables.PREFIX + "pong", [STICK, n], addr, now=10.02)
    assert wear.listing(now=10.1)[0]["latency"] == pytest.approx(10.0)


# ---------- back to the radio ----------
def test_a_stick_on_the_wifi_whose_receiver_is_plugged_in_is_told_to_come_over(rx, wear, monkeypatch):
    monkeypatch.setattr(wear, "radio_for", lambda id_: receiver.channel_for(id_, now=100.0))
    feed(rx, hline(STICK, channel=6))
    wear.on_osc(wearables.PREFIX + "hello", [STICK, "sticks3", "", 50, "1.1.0"], ("192.168.1.50", 4000), now=100.0)
    assert [p for _, a, p in wear.transport.sent if a.endswith("/radio")] == [[6]]
    wear.transport.sent.clear()
    wear.on_osc(wearables.PREFIX + "hello", [OTHER, "sticks3", "", 50, "1.1.0"], ("192.168.1.51", 4000), now=100.0)
    assert not any(a.endswith("/radio") for _, a, _ in wear.transport.sent)   # not paired with it: nothing
    monkeypatch.setattr(wear, "radio_for", lambda id_: receiver.channel_for(id_, now=100.0 + receiver.SILENT + 1))
    wear.on_osc(wearables.PREFIX + "hello", [STICK, "sticks3", "", 50, "1.1.0"], ("192.168.1.50", 4000), now=110.0)
    assert not any(a.endswith("/radio") for _, a, _ in wear.transport.sent)   # the receiver fell silent: nothing


def test_a_stick_that_falls_back_to_the_wifi_is_answered_there(rx, wear, fake):
    feed(rx, hline(STICK), pline(hello()))
    assert wear.devices[STICK].via is rx
    fake.heard()
    wear.on_osc(wearables.PREFIX + "hello", [STICK, "sticks3", "", 50, "1.1.0"], ("192.168.1.50", 4000), now=101.0)
    dev = wear.devices[STICK]
    assert dev.via is None and dev.addr == ("192.168.1.50", 4000)
    assert [a for a, addr, _ in [(x[1], x[0], x[2]) for x in wear.transport.sent]] == ["/dream/wear/state"]
    assert fake.heard() == []                                      # nothing by radio any more


# ---------- finding it, letting go ----------
def test_a_port_that_says_nothing_is_closed_and_never_written_to(fake):
    assert receiver.probe(fake.path, wait=0.3) is False
    assert fake.heard(0.1) == []


def test_looking_finds_the_receiver_listens_and_lets_go_when_it_is_unplugged(fake, wear, monkeypatch):
    monkeypatch.setenv("DREAM_RECEIVER", fake.path)
    monkeypatch.setattr(receiver, "links", {})
    monkeypatch.setattr(receiver, "skip", {})

    async def run():
        fake.say(hline(f"{STICK}*"))
        await receiver.look(wear)
        assert list(receiver.links) == [fake.path]
        assert await asyncio.to_thread(fake.heard) == ["?"]          # only now Dream speaks to it
        fake.say(pline(hello()))
        for _ in range(50):
            await asyncio.sleep(0.02)
            if STICK in wear.devices:
                break
        assert wear.devices[STICK].via is receiver.links[fake.path]  # through the reading thread into the event loop
        r = receiver.links[fake.path]
        await receiver.look(wear)
        assert receiver.links == {fake.path: r}                      # looked at again: kept, not opened twice
        monkeypatch.setenv("DREAM_RECEIVER", "off")
        await receiver.look(wear)
        assert receiver.links == {} and r.closed and wear.devices[STICK].via is None
    asyncio.run(run())


def test_while_flash_sh_runs_dream_holds_no_port(fake, wear, monkeypatch, sandbox):
    monkeypatch.setenv("DREAM_RECEIVER", fake.path)
    monkeypatch.setattr(receiver, "links", {})
    monkeypatch.setattr(receiver, "skip", {})
    os.makedirs(sandbox["DREAM_STATE_DIR"], exist_ok=True)
    note = receiver.pause_file()
    assert note.startswith(sandbox["DREAM_STATE_DIR"])

    async def run():
        fake.say(hline())
        await receiver.look(wear)
        r = receiver.links[fake.path]
        with open(note, "w") as f:
            f.write(f"{os.getpid()}\n")                              # flash.sh's pid: it runs
        await receiver.look(wear)
        assert receiver.links == {} and r.closed
        await asyncio.to_thread(r.thread.join, 2)                    # its reading thread let go of the port
        fake.say(hline())
        await receiver.look(wear)
        assert receiver.links == {}                                  # not opened again meanwhile
        os.utime(note, (time.time() - receiver.PAUSE_MAX - 1,) * 2)   # a note left over, too old: ignored
        await receiver.look(wear)
        assert list(receiver.links) == [fake.path]
        assert not receiver.paused()
        os.utime(note)
        assert receiver.paused()
        dead = subprocess.Popen(["true"])
        dead.wait()
        with open(note, "w") as f:
            f.write(f"{dead.pid}\n")                                 # its script was killed: ignored at once
        assert not receiver.paused()
        receiver.stop()
    asyncio.run(run())


def test_a_port_held_by_another_is_left_alone(fake):
    import fcntl
    fd = os.open(fake.path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)                               # esptool holds it
        fake.say(hline())
        assert receiver.probe(fake.path, wait=0.3) is True               # tried again at the next look, not left alone
    finally:
        os.close(fd)


def test_which_ports_are_looked_at(monkeypatch):
    assert os.environ["DREAM_RECEIVER"] == "off" and receiver.candidates() == []     # the tests: none (conftest)
    monkeypatch.setenv("DREAM_RECEIVER", "/dev/ttys901,/dev/ttys902")
    assert receiver.candidates() == ["/dev/ttys901", "/dev/ttys902"]
    monkeypatch.setenv("DREAM_RECEIVER", "")
    monkeypatch.setattr(receiver.glob, "glob", lambda pattern: {"/dev/cu.usbmodem*": ["/dev/cu.usbmodem1101"],
                                                                "/dev/ttyACM*": ["/dev/ttyACM0"]}[pattern])
    assert receiver.candidates() == ["/dev/cu.usbmodem1101", "/dev/ttyACM0"]


def test_a_port_that_was_no_receiver_is_looked_at_again_when_a_receiver_is_swapped_onto_it(fake, wear, monkeypatch):
    # the StickS3 on the port first (it says nothing Dream knows), then quickly the AtomS3 on the same port: the port
    # never went away, yet the receiver is found once SKIP_FOR has passed
    monkeypatch.setenv("DREAM_RECEIVER", fake.path)
    monkeypatch.setattr(receiver, "links", {})
    monkeypatch.setattr(receiver, "skip", {})
    monkeypatch.setattr(receiver, "PROBE_WAIT", 0.3)

    async def run():
        await receiver.look(wear)
        assert receiver.links == {} and fake.path in receiver.skip
        fake.say(hline())
        await receiver.look(wear)
        assert receiver.links == {}                                  # left alone for a while
        receiver.skip[fake.path] -= receiver.SKIP_FOR                # a while later
        fake.say(hline())
        await receiver.look(wear)
        assert list(receiver.links) == [fake.path] and receiver.skip == {}
        receiver.stop()
    asyncio.run(run())
