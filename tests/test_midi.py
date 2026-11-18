"""MIDI mapping helpers (midi.py): keys, scaling, endless knobs, learning and button actions – without a MIDI device."""
import json
from types import SimpleNamespace as Msg

import midi


def cc(control, value, channel=0):
    return Msg(type="control_change", channel=channel, control=control, value=value)


def note(n, velocity=100, on=True, channel=0):
    return Msg(type="note_on" if on else "note_off", channel=channel, note=n, velocity=velocity)


def test_key_of():
    assert midi.key_of(cc(7, 0)) == "c1:cc7"
    assert midi.key_of(note(36, channel=9)) == "c10:n36"
    assert midi.key_of(note(36, on=False)) == "c1:n36"
    assert midi.key_of(Msg(type="pitchwheel", channel=0)) is None


def test_scale():
    assert midi.scale(0, "strength") == 0.0
    assert midi.scale(127, "strength") == 0.95
    assert midi.scale(500, "zoom") == 0.06            # clamped to 0..127
    assert midi.scale(-3, "zoom") == -0.04


def test_nudge():
    assert midi.nudge(0.5, 1, "strength") == round(0.5 + 0.0095, 4)
    assert midi.nudge(0.5, 127, "strength") == round(0.5 - 0.0095, 4)
    assert midi.nudge(0.95, 3, "strength") == 0.95    # stays in the range
    assert midi.nudge(0.0, 65, "strength") == 0.0


def test_relative_guess():
    g = midi.RelativeGuess()
    assert [g.is_relative("k", v) for v in (1, 1, 127, 1)] == [None, None, None, True]
    f = midi.RelativeGuess()
    assert f.is_relative("f", 64) is False            # a value from the middle: a fader for good
    assert f.is_relative("f", 1) is False


def test_targets_and_actions_are_known():
    assert all(lo < hi for lo, hi in midi.TARGETS.values())
    assert {"fx_" + e for e in midi.FX} <= set(midi.ACTIONS)


def test_save_and_load_map(sandbox):
    assert midi.load_map() == {}
    midi.save_map({"c1:cc7": {"target": "strength"}, "broken": 3})
    with open(midi.MAP_FILE) as f:
        assert json.load(f)["c1:cc7"] == {"target": "strength"}
    assert midi.MAP_FILE.startswith(sandbox["DREAM_CONFIG_DIR"])
    assert midi.load_map() == {"c1:cc7": {"target": "strength"}}     # entries that are not a dict are dropped
    with open(midi.MAP_FILE, "w") as f:
        f.write("{not json")
    assert midi.load_map() == {}


def run(mapping, *msgs, learn=None, state=None):
    thr, guess = midi.Throttle(), midi.RelativeGuess()
    learn = {} if learn is None else learn
    for m in msgs:
        midi.handle(mapping, thr, guess, learn, state or {}, midi.key_of(m), m)
    return thr


def test_learn_maps_the_next_control():
    mapping, learn = {}, {"target": "zoom"}
    thr = run(mapping, cc(21, 40), learn=learn)
    assert mapping == {"c1:cc21": {"target": "zoom"}} and learn == {}
    assert thr.learned == {"key": "c1:cc21", "target": "zoom"}
    assert midi.load_map() == mapping


def test_learn_an_action_ignores_note_off():
    mapping, learn = {}, {"target": "blackout"}
    run(mapping, note(36, on=False), learn=learn)
    assert mapping == {} and learn
    run(mapping, note(36), learn=learn)
    assert mapping == {"c1:n36": {"action": "blackout"}}


def test_button_fires_once_per_press():
    thr = run({"c1:n36": {"action": "next"}}, note(36), note(36), note(36, on=False), note(36))
    assert thr.take()[1] == ["next", "next"]


def test_fader_moves_its_target():
    thr = run({"c1:cc7": {"target": "strength"}}, cc(7, 64), cc(7, 127))
    assert thr.take()[0] == {"strength": 0.95}


def test_unknown_target_is_ignored():
    thr = run({"c1:cc7": {"target": "backend"}}, cc(7, 64))
    assert thr.take() == ({}, [], None)
