"""Motion sensors over OSC (sensors.py): channels, impulses, learning – with the time handed in, no OSC port."""
import json
import os

import midi
import sensors


def test_channels_from_numbers():
    s = sensors.Sensors()
    s.on_osc("/orientation", [1.0, 2, "x", True, float("nan"), 4.0, 5.0], now=100.0)
    assert set(s.ch) == {"/orientation:0", "/orientation:1", "/orientation:2", "/orientation:3"}   # at most four
    s.on_osc("/nothing", ["a", float("inf")], now=100.1)
    assert "/nothing:0" not in s.ch


def test_channel_normalises_to_its_range():
    c = sensors.Channel(0.0)
    for _ in range(30):
        c.update(10.0)
    assert 0.95 < c.norm <= 1.0
    for _ in range(30):
        c.update(0.0)
    assert 0.0 <= c.norm < 0.05


def test_swing_from_the_gyroscope():
    s = sensors.Sensors()
    s.on_osc("/gyroscope", [0.0, 0.0, 0.0], now=1.0)
    s.on_osc("/gyroscope", [3.0, 4.0, 0.0], now=1.1)
    assert "swing" in s.ch and s.ch["swing"].v > 0


def test_impulse_with_dead_time():
    s = sensors.Sensors()
    for i in range(20):                                  # resting arm: gravity only
        s.on_osc("/linear_acceleration", [0.1, 0.0, 0.0], now=10 + i * 0.03)
    assert s.events == []
    s.on_osc("/linear_acceleration", [30.0, 0.0, 0.0], now=11.00)   # a whip
    s.on_osc("/linear_acceleration", [30.0, 0.0, 0.0], now=11.10)   # the same whip, inside the 250 ms
    s.on_osc("/linear_acceleration", [30.0, 0.0, 0.0], now=11.40)   # the next one
    assert [e[0] for e in s.events] == ["impulse", "impulse"]
    assert all(0 < e[1] <= 1 for e in s.events)


def test_learning_picks_the_channel_that_moves(sandbox):
    s = sensors.Sensors()
    for i in range(10):                                  # before: both channels nearly still
        s.on_osc("/a", [0.5 + 0.001 * (i % 2), 0.5], now=1 + i * 0.05)
    s.start_learning("zoom", now=2.0)
    for i in range(60):                                  # while learning: the second number swings
        s.on_osc("/a", [0.5, 1.0 * (i % 2)], now=2.0 + i * 0.05)
    assert ("learned", "/a:1", "zoom") in s.events
    m = s.mapping["/a:1"]
    assert (m["target"], m["invert"]) == ("zoom", False) and 0 < m["lo"] < m["hi"] < 1   # #240: the range shown
    with open(sensors.MAP_FILE) as f:
        assert json.load(f)["/a:1"]["target"] == "zoom"
    assert sensors.MAP_FILE.startswith(sandbox["DREAM_CONFIG_DIR"])


def test_learning_without_movement_learns_nothing():
    s = sensors.Sensors()
    s.on_osc("/a", [0.5], now=1.0)
    s.start_learning("zoom", now=1.0)
    s.on_osc("/a", [0.5], now=4.0)
    assert s.events == [("learned", "", "zoom")] and "/a:0" not in s.mapping


def test_values_and_invert():
    s = sensors.Sensors()
    s.mapping = {"/a:0": {"target": "strength"}, "/a:1": {"target": "zoom", "invert": True},
                 "/a:2": {"target": "backend"}, "impulse": {"action": "flash"}}
    s.on_osc("/a", [0.0, 0.0, 0.0], now=1.0)
    for _ in range(40):
        s.on_osc("/a", [1.0, 1.0, 1.0], now=1.5)
    v = s.values(midi.TARGETS)
    assert v["strength"] > 0.9 and v["zoom"] < -0.03 and "backend" not in v


def test_broken_map_file(sandbox):
    os.makedirs(os.path.dirname(sensors.MAP_FILE), exist_ok=True)
    with open(sensors.MAP_FILE, "w") as f:
        f.write("[1, 2]")
    assert sensors.load_map() == {}


def test_live():
    s = sensors.Sensors()
    s.on_osc("/gyro", [1.0, 2.0], source="192.168.1.40", now=1.0)
    live = s.live()
    assert live["source"] == "192.168.1.40" and set(live["channels"]) == {"/gyro:0", "/gyro:1"}


# ---------- #240: learning from Dream Control's motion, and what a learned channel does to its slider ----------
def phone(s, t, tilt, strike=0.0, noise=0.0):
    """What Dream Control sends (ctl.feed_motion): tilt in degrees around the device's x axis."""
    import math
    g = 9.81
    s.on_osc("/device/accelerometer", [strike + noise, g * math.sin(math.radians(tilt)), g * math.cos(math.radians(tilt))], now=t)
    s.on_osc("/device/linear_acceleration", [strike + noise, 0.0, 0.0], now=t)
    s.on_osc("/device/gyroscope", [noise, 0.0, 0.0], now=t)
    s.on_osc("/device/orientation", [10.0, tilt + noise, 0.0], now=t)


def test_learning_after_the_device_was_moved_before(sandbox):
    """A phone in the hand was turned and swung before "Learn" was tapped: its learning movement still counts."""
    import math
    s = sensors.Sensors()
    t = 0.0
    for i in range(240):                                 # 8 s of handling: turned far, struck now and then
        t = i / 30
        phone(s, t, 60 * math.sin(t * 2), strike=25.0 if i % 60 == 0 else 0.0)
    for i in range(30):                                  # a moment held still
        t += 1 / 30
        phone(s, t, 20.0)
    s.start_learning("master", now=t)
    for i in range(90):                                  # learning: tilted back and forth, less than before
        t += 1 / 30
        phone(s, t, 20 + 25 * math.sin(i / 30 * 4))
    learned = [e for e in s.events if e[0] == "learned"]
    assert learned and learned[-1][1], learned
    assert s.mapping[learned[-1][1]]["target"] == "master"


def test_learning_a_target_again_replaces_its_channel(sandbox):
    """Learned once on the panel, once more on the phone: one channel steers the slider, not two pulling at it."""
    import math
    s = sensors.Sensors()
    s.mapping = {"/device/linear_acceleration:0": {"target": "master", "invert": False},
                 "/device/gyroscope:0": {"target": "zoom", "invert": False}}
    for i in range(30):
        phone(s, i / 30, 0.0)
    s.start_learning("master", now=1.0)
    for i in range(90):
        phone(s, 1.0 + i / 30, 30 * math.sin(i / 30 * 3))
    assert [k for k, m in s.mapping.items() if m.get("target") == "master"] == ["/device/orientation:1"]
    assert s.mapping["/device/gyroscope:0"]["target"] == "zoom"


def test_learning_takes_the_tilt_not_the_shake(sandbox):
    """A shake moves the shaken axis most – but on a slider that is noise around zero with spikes."""
    import math
    s = sensors.Sensors()
    for i in range(120):                                 # picked up and turned slowly, then held still for a second
        phone(s, i / 30, 40 * math.sin(i / 30 * 1.5))
    for i in range(30):
        phone(s, 4 + i / 30, 0.0)
    s.start_learning("master", now=5.0)
    for i in range(90):                                  # a shake that also tilts the phone a little
        t = 5.0 + i / 30
        phone(s, t, 10 * math.sin(t * 6), strike=15.0 * (1 if i % 2 else -1))
    learned = [e for e in s.events if e[0] == "learned"][-1]
    # the tilt, as an angle (the accelerometer shows it too, but every strike shakes it) – not the shaken axis
    assert learned[1] == "/device/orientation:1", learned


def test_a_resting_device_holds_its_slider(sandbox):
    """With the learned range a phone put down keeps the slider still – the auto-range shrank onto its noise."""
    import random
    random.seed(4)
    s = sensors.Sensors()
    s.mapping = {"/device/orientation:1": {"target": "master", "invert": False, "lo": -30.0, "hi": 30.0}}
    t, seen = 0.0, []
    for i in range(30 * 40):                             # 40 s on the table, the sensor's own noise only
        t = i / 30
        phone(s, t, 5.0, noise=random.gauss(0, 0.3))
        if i > 30 * 20:
            seen.append(s.values(midi.TARGETS)["master"])
    assert max(seen) - min(seen) < 0.03, (min(seen), max(seen))
    assert abs(seen[-1] - (5 + 30) / 60) < 0.03


def test_an_angle_does_not_jump_at_a_full_turn():
    s = sensors.Sensors()
    for i, a in enumerate([350.0, 355.0, 359.0, 2.0, 6.0]):
        s.on_osc("/device/orientation", [a, 0.0, 0.0], now=1 + i * 0.03)
    c = s.ch["/device/orientation:0"]
    assert c.hi - c.lo < 20, (c.lo, c.hi)               # 350° … 366°, not 2° … 359°
