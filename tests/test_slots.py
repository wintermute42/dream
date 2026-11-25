"""#265 (a prototype): the slots of Dream Dance – what a set of slots may say (three strengths, an accent's tolerance,
moves of one's own), how it becomes rows of the dance table, the built-in sets that are never changed (a change is a
draft, saved as a new set – not through /ctl either), renaming, deleting and its undo, and the switch between the old
table and the slots that loses nothing."""
import asyncio
import json
import os

import pytest

import dance
import playlists
import settings
from test_rights import client, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401  (the roles' devices; nothing left behind)

GOOD_ROW = {"id": "a1", "on": True, "src": "l.palm", "dst": "fx.kaleido", "curve": "soft", "in": [0.2, 0.9], "out": [0.0, 0.8],
            "smooth": 0.3, "origin": "own"}


@pytest.fixture
def slots(monkeypatch):
    """The tables and slots Dream holds come back afterwards (the file is the sandbox's: conftest)."""
    monkeypatch.setattr(dance, "tables", dance.default_tables())
    monkeypatch.setattr(dance, "sets", {})
    monkeypatch.setattr(dance, "slot_sets", {})
    monkeypatch.setattr(dance, "slot_use", "standard")
    monkeypatch.setattr(dance, "slot_drafts", {})
    yield dance
    if os.path.exists(dance.MAP_FILE):
        os.remove(dance.MAP_FILE)


def test_the_groups_are_the_engines_and_cover_every_effect():
    js = open(os.path.join(os.path.dirname(dance.__file__), "static", "dancemap.js")).read()
    for group, effects in dance.GROUPS.items():
        assert f"{group}: [{', '.join(repr(e) for e in effects)}]" in js, group     # the same groups in the engine
    assert sorted(dance.GROUP_OF) == sorted(playlists.FX)                        # every effect has its group, once


def test_the_built_in_sets_keep_the_rules():
    for name, s in dance.SLOT_SETS.items():
        assert dance.clean_slots(s) == s, name                                     # nothing to drop: every slot fits
        assert all(s["base"]) and all(s["accents"]) and len(s["hands"]) <= dance.MAX_HANDS
        base = {dance.GROUP_OF[x["fx"]] for x in s["base"]}
        assert len(base) == 2 and not base & {dance.GROUP_OF[x["fx"]] for x in s["accents"]}, name
    assert list(dance.SLOT_SETS) == ["standard", "waves", "fire"] == list(dance.builtin_sets())   # the same names as the table's sets


def test_what_a_set_of_slots_may_say():
    clean = dance.clean_slots
    assert clean(None) is None and clean([]) is None
    # an empty set does not exist: nothing occupied is Standard's occupation
    assert clean({}) == dance.SLOT_SETS["standard"] and clean({"base": [None, None], "hands": []}) == dance.SLOT_SETS["standard"]
    got = clean({"base": [{"src": "energy", "fx": "waves", "amt": 7}, {"src": "open", "fx": "tunnel"}, {"src": "turn", "fx": "rgb"}],
                 "accents": [{"src": "g.wave", "fx": "waves"}, {"src": "g.nope", "fx": "rgb"}, {"src": "g.push", "fx": "nowhere"},
                             {"src": "g.push", "fx": "kaleido", "amt": "x"}, {"src": "g.circle", "fx": "hue", "amt": 0.2}],
                 "hands": ["light", "paint", "warp", "fly"]})
    assert got["base"] == [{"src": "energy", "fx": "waves", "amt": 1.0}, None]                  # same group as base 1: dropped; a third base: none
    assert got["accents"] == [None, None, None, None]                                            # taken, unknown gesture, unknown effect, odd strength
    assert got["hands"] == ["paint", "warp"]                                                     # known ones, at most two, in their order
    assert dance.slot_conflict({"base": [{"src": "energy", "fx": "trails", "amt": 1}, None], "accents": []}, "accents", 0, "feedback") == "base"
    assert dance.slot_conflict({"base": [{"src": "energy", "fx": "trails", "amt": 1}, None], "accents": []}, "base", 1, "feedback") == "group"
    assert dance.slot_conflict({"base": [{"src": "energy", "fx": "trails", "amt": 1}, None], "accents": []}, "base", 0, "feedback") is None   # its own place


def test_slots_become_rows_of_the_dance_table():
    s = dance.SLOT_SETS["fire"]
    rows = dance.compile_slots(s)
    assert dance.clean_rows(rows) == rows                                        # valid rows of the one table
    by = {r["id"]: r for r in rows}
    assert by["base0"]["src"] == "energy" and by["base0"]["dst"] == "fx.feedback" and by["base0"]["curve"] == "soft"
    assert by["base1"]["src"] == "height" and by["base1"]["in"] == [0.55, 1.0]  # Dream picks range and curve per movement
    assert [by[f"accent{i}"]["src"] for i in range(4)] == ["g.throw", "g.push", "g.circle", "g.wave"]
    # one strength per slot – and even the lowest acts visibly (the engine's minimum)
    low = dance.compile_slots(dance.clean_slots({"accents": [{"src": "g.throw", "fx": "tunnel", "amt": 0}]}))
    assert [r for r in low if r["id"] == "accent0"][0]["out"] == [0.0, dance.SLOT_MIN]
    assert by["accent0"]["out"][1] == 1.0
    # the hands in the picture are switches: only the chosen ones are on
    assert {r["id"]: r["on"] for r in rows if r["dst"].startswith("touch.") and r["id"] in dance.HANDS} == {
        "paint": False, "warp": True, "impulse": True, "light": False}
    assert all(r["origin"] == "slot" for r in rows)
    # turning as a base movement: both ways alike (the curve "v"), and no second row turns the effects
    turned = dance.compile_slots(dance.clean_slots({"base": [{"src": "turn", "fx": "mirror", "amt": 1}]}))
    assert [r["curve"] for r in turned if r["id"] == "base0"] == ["v"] and not any(r["dst"] == "fx.spin" for r in turned)


def test_a_strength_is_one_of_three_steps_each_clearly_seen():
    got = dance.clean_slots({"base": [{"src": "energy", "fx": "waves", "amt": 0.2}, {"src": "open", "fx": "kaleido", "amt": 0.3}],
                             "accents": [{"src": "g.throw", "fx": "trails", "amt": 0.8}]})
    assert [s["amt"] for s in got["base"]] + [got["accents"][0]["amt"]] == [0.0, 0.5, 1.0]     # light, medium, strong
    peaks = [dance.peak(a) for a in dance.STEPS]
    assert peaks == [dance.SLOT_MIN, 0.675, 1.0] and all(b - a > 0.3 for a, b in zip(peaks, peaks[1:]))   # light is seen, each step is another
    rows = {r["id"]: r for r in dance.compile_slots(got)}
    assert [rows["base0"]["out"][1], rows["base1"]["out"][1], rows["accent0"]["out"][1]] == peaks
    for s in dance.SLOT_SETS.values():                                           # the built-in sets use the steps
        assert {x["amt"] for w in ("base", "accents") for x in s[w]} <= set(dance.STEPS)


def test_an_accent_has_its_tolerance_and_may_be_a_move_of_ones_own():
    got = dance.clean_slots({"accents": [{"src": "g.throw", "fx": "tunnel"}, {"src": "g.m0a1b2c3d", "fx": "rgb", "tol": "loose"},
                                         {"src": "g.push", "fx": "hue", "tol": "sloppy"}, {"src": "g.mNOPE", "fx": "glitch"}]})
    assert got["accents"] == [{"src": "g.throw", "fx": "tunnel", "amt": 1.0, "tol": "normal"}, {"src": "g.m0a1b2c3d", "fx": "rgb", "amt": 1.0, "tol": "loose"}, None, None]
    assert dance.tolerance_of(got) == {"throw": "normal", "m0a1b2c3d": "loose"}  # what the stage's detector is told
    assert "tol" not in dance.clean_slots({"base": [{"src": "energy", "fx": "waves", "tol": "tight"}]})["base"][0]   # base movements have none
    js = open(os.path.join(os.path.dirname(dance.__file__), "static", "dance.js")).read()
    assert "const TOL = { tight: 0.75, normal: ON, loose: 0.45 };" in js and list(dance.TOLERANCES) == ["tight", "normal", "loose"]


def test_a_change_is_a_draft_and_a_built_in_set_is_saved_as_a_new_set(slots):
    before = slots.builtin_slots()
    changed = {**before["waves"], "hands": ["light"]}
    assert slots.use_slots("waves") and slots.draft_slots("waves", changed)
    assert slots.slots_now()["hands"] == ["light"] and slots.slots_msg()["drafts"] == {"waves": slots.clean_slots(changed)}   # played at once
    assert slots.slots_msg()["rows"] == slots.compile_slots(slots.slots_now())
    assert slots.save_slots("waves") is False and slots.builtin_slots() == before and slots.SLOT_SETS == before   # never changed
    assert json.load(open(slots.MAP_FILE))["slots"] == {"use": "waves", "sets": {}}   # a draft is never in the file
    # the name is the dancer's: a valid one nobody has – never a number added silently
    for bad in ("waves", "Standard/2", "", "x" * 33):
        assert slots.save_slots_as(bad, changed, "waves") is False, bad
    assert slots.save_slots_as("Waves – mine", changed, "waves")
    assert slots.slot_use == "Waves – mine" and slots.slot_drafts == {} and slots.slot_sets["Waves – mine"] == {"from": "waves", "slots": slots.clean_slots(changed)}
    assert slots.load_slots() == (slots.slot_sets, "Waves – mine")             # kept in the file, read back the same
    # an own set keeps its draft with "save"; "discard" throws a draft away; a draft that is the set is none
    assert slots.draft_slots("Waves – mine", before["fire"]) and slots.save_slots("Waves – mine")
    assert slots.all_slots()["Waves – mine"] == before["fire"] and slots.slot_drafts == {}
    assert slots.draft_slots("Waves – mine", before["standard"]) and slots.discard_slots("Waves – mine")
    assert slots.all_slots()["Waves – mine"] == before["fire"] and not slots.discard_slots("Waves – mine")
    assert slots.draft_slots("Waves – mine", before["fire"]) and slots.slot_drafts == {}
    # switching keeps a draft where it is: coming back brings the changes back
    assert slots.draft_slots("standard", changed) and slots.use_slots("fire") and slots.slots_now() == before["fire"]
    assert slots.use_slots("standard") and slots.slots_now() == slots.clean_slots(changed)


def test_an_own_set_is_renamed_and_deleted_and_the_deletion_undone(slots):
    assert slots.save_slots_as("Mine", slots.SLOT_SETS["fire"], "fire") and slots.save_slots_as("Other", slots.SLOT_SETS["waves"], "waves")
    assert slots.rename_slots("waves", "x") is False and slots.rename_slots("Mine", "Other") is False and slots.rename_slots("Mine", "a/b") is False
    assert slots.draft_slots("Other", slots.SLOT_SETS["standard"]) and slots.rename_slots("Other", "Night – 2")
    assert slots.slot_use == "Night – 2" and "Night – 2" in slots.slot_drafts and "Other" not in slots.all_slots()   # its draft and its use go along
    kept = slots.slot_sets["Night – 2"]
    assert slots.delete_slots("Night – 2") and slots.slot_use == "waves" and slots.slot_drafts == {}   # back to the set it came from
    assert slots.delete_slots("standard") is False and slots.delete_slots("Night – 2") is False
    assert slots.save_slots_as("Night – 2", kept["slots"], kept["from"]) and slots.slot_sets["Night – 2"] == kept   # the undo
    assert slots.delete_slots("Mine") and slots.delete_slots("Night – 2") and slots.use_slots("standard")
    assert not os.path.exists(slots.MAP_FILE)                                    # nothing of the owner's left: no file


def test_a_deleted_move_leaves_the_accents(slots):
    own = {"accents": [{"src": "g.m0a1b2c3d", "fx": "rgb"}, {"src": "g.throw", "fx": "tunnel"}]}
    assert slots.save_slots_as("Mine", own, "standard") and slots.draft_slots("standard", own)
    assert slots.drop_source("g.m0a1b2c3d") is True
    assert slots.all_slots()["Mine"]["accents"][0] is None and slots.slot_drafts["standard"]["accents"][0] is None
    assert slots.all_slots()["Mine"]["accents"][1]["src"] == "g.throw" and slots.drop_source("g.m0a1b2c3d") is False


def test_slots_in_a_broken_file_are_no_slots(slots):
    os.makedirs(os.path.dirname(slots.MAP_FILE), exist_ok=True)
    for broken in ('{"slots": 7}', '{"slots": {"sets": {"waves": {"slots": {}}}, "use": "waves"}}', '{"slots": {"sets": [], "use": "gone"}}',
                   '{"slots": {"sets": {"a/b": {"slots": {}}, "ok": 7}}}'):
        with open(slots.MAP_FILE, "w") as f:
            f.write(broken)
        own, use = slots.load_slots()
        assert own == {} and use in ("standard", "waves"), broken


def _talk(server, role, *msgs):
    with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
        assert ws.receive_json()["role"] == role
        for m in msgs:
            ws.send_text(json.dumps(m))
        ws.send_text(json.dumps({"set": {"prompt": "after the slots"}}))
        if role != "eyes":
            wait_until(lambda: server.hub.state["prompt"] == "after the slots")
        else:
            ws.send_text(json.dumps({"feed": {"cam": False}}))


@pytest.mark.parametrize("role", ["local", "control", "guest", "eyes"])
def test_no_device_overwrites_a_built_in_set_through_ctl(server, slots, saved_state, role):
    before = slots.builtin_slots()
    _talk(server, role, {"dance_slots": {"op": "draft", "name": "standard", "slots": {"base": [{"src": "energy", "fx": "glitch"}]}}},
          {"dance_slots": {"op": "save", "name": "standard"}}, {"dance_slots": {"op": "delete", "name": "waves"}},
          {"dance_slots": {"op": "rename", "name": "fire", "as": "Mine"}}, {"dance_slots": {"op": "save_as", "name": "standard", "slots": {}, "from": "fire"}})
    assert server.dance.builtin_slots() == before and server.dance.slot_sets == {}
    assert ("standard" in server.dance.slot_drafts) is (role in ("local", "control"))   # a draft is a hand's change, played – never kept


@pytest.mark.parametrize("role,may", [("local", True), ("control", True), ("guest", False), ("eyes", False)])
def test_only_control_and_this_mac_change_and_save_slots(server, slots, saved_state, role, may):
    _talk(server, role, {"set": {"dance_ui": "slots"}}, {"set": {"dance_set": "fire"}},
          {"dance_slots": {"op": "draft", "name": "fire", "slots": {"accents": [{"src": "g.wave", "fx": "pixel", "amt": 0.5, "tol": "tight"}]}}},
          {"dance_slots": {"op": "save_as", "name": "Fire – mine", "slots": {"accents": [{"src": "g.wave", "fx": "pixel", "amt": 0.5, "tol": "tight"}]}, "from": "fire"}})
    if may:
        assert server.dance.all_slots()["Fire – mine"]["accents"][0] == {"src": "g.wave", "fx": "pixel", "amt": 0.5, "tol": "tight"}
        assert server.dance.slot_use == "Fire – mine" and server.hub.state["dance_set"] == "Fire – mine"   # in use, and the setting says so
        assert server.dance.slots_msg()["rows"] == dance.compile_slots(server.dance.all_slots()["Fire – mine"]) and server.dance.slot_drafts == {}
    else:
        assert server.dance.slot_sets == {} and server.dance.slot_drafts == {}


def test_switching_between_the_table_and_the_slots_loses_nothing(server, slots, saved_state):
    assert settings.SETTINGS["dance_ui"].default == "table"                     # as before, until the owner switches
    _talk(server, "control", {"dance_map": [GOOD_ROW]}, {"set": {"dance_ui": "slots"}}, {"set": {"dance_set": "waves"}},
          {"dance_slots": {"op": "save_as", "name": "Mine", "slots": dance.SLOT_SETS["waves"], "from": "waves"}})
    # with the slots, choosing a set chose a set of slots – the table stayed exactly the owner's
    assert server.dance.tables["dance"] == [GOOD_ROW] and server.dance.slot_use == "Mine"
    assert server.inputs.next_set(server.hub.state["dance_set"]) == "standard"   # the MIDI button walks the sets of slots
    _talk(server, "control", {"set": {"dance_ui": "table"}})
    assert server.dance.tables["dance"] == [GOOD_ROW] and server.dance.slot_use == "Mine" and "Mine" in server.dance.slot_sets
    _talk(server, "control", {"set": {"dance_set": "fire"}})                    # the table's sets act on the table again
    assert server.dance.tables["dance"] == dance.builtin_sets()["fire"] and server.dance.slot_use == "Mine"
    _talk(server, "control", {"set": {"dance_ui": "slots"}})
    assert server.dance.slots_msg()["use"] == "Mine"                             # the slots as they were


def test_every_device_is_told_the_slots(server, slots):
    with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ws:
        got = [ws.receive_json() for _ in range(7)]
    (told,) = [m["dance"]["slots"] for m in got if "slots" in m.get("dance", {})]
    assert told["use"] == "standard" and told["sets"] == ["standard", "waves", "fire"] and told["own"] == []
    assert told["rows"] == dance.compile_slots(dance.SLOT_SETS["standard"]) and set(told["data"]) == set(told["sets"])


def test_the_scene_and_midi_choose_sets_of_slots(server, slots, saved_state):
    asyncio.run(server.hub.apply({"dance_ui": "slots"}))
    asyncio.run(server.hub.apply({"dance_set": "fire"}))
    assert server.dance.slot_use == "fire" and server.dance.tables["dance"] == dance.default_tables()["dance"]
    assert server.inputs.next_set("") == "standard"                              # after fire: round again
    asyncio.run(server.hub.apply({"dance_set": "no such set"}))
    assert server.dance.slot_use == "fire"
    asyncio.run(server.hub.apply({"dance_ui": "table"}))
