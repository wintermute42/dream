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
    assert s.mapping["/a:1"] == {"target": "zoom", "invert": False}
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
