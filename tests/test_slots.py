"""#265 (a prototype): the slots of Dream Dance – what a set of slots may say, how it becomes rows of the dance table,
the built-in sets that can't be changed (not through /ctl either), and the switch between the old table and the slots
that loses nothing."""
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


def test_a_built_in_set_is_never_changed_and_an_own_copy_can_be_reset(slots):
    before = slots.builtin_slots()
    assert slots.save_slots("waves", {"base": [{"src": "energy", "fx": "glitch"}]}) is False
    assert slots.reset_slots("waves") is True and slots.delete_slots("waves") is False
    assert slots.adapt_slots("waves", "waves") is False and slots.adapt_slots("nope", "Mine") is False
    assert slots.adapt_slots("waves", "My waves") is True and slots.adapt_slots("waves", "My waves") is False
    assert slots.save_slots("My waves", {"base": [{"src": "energy", "fx": "glitch", "amt": 0.3}]})
    assert slots.all_slots()["My waves"]["base"] == [{"src": "energy", "fx": "glitch", "amt": 0.3}, None]
    assert slots.builtin_slots() == before and slots.SLOT_SETS == before          # the built-in ones as they were
    # a copy of a copy remembers the built-in set it came from; reset brings that one's slots
    assert slots.adapt_slots("My waves", "Copy 2") and slots.slot_sets["Copy 2"]["from"] == "waves"
    assert slots.reset_slots("My waves") and slots.all_slots()["My waves"] == before["waves"]
    # kept in the file, read back the same
    assert slots.use_slots("Copy 2") and os.path.exists(slots.MAP_FILE)
    assert slots.load_slots() == (slots.slot_sets, "Copy 2")
    # removing the set in use goes back to the built-in one it came from; with nothing of the owner's left the file goes
    assert slots.delete_slots("Copy 2") and slots.slot_use == "waves"
    assert slots.delete_slots("My waves") and slots.use_slots("standard")
    assert not os.path.exists(slots.MAP_FILE)


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
    _talk(server, role, {"dance_slots": {"op": "save", "name": "standard", "slots": {"base": [{"src": "energy", "fx": "glitch"}]}}},
          {"dance_slots": {"op": "reset", "name": "fire"}}, {"dance_slots": {"op": "delete", "name": "waves"}},
          {"dance_slots": {"op": "adapt", "name": "glitch", "as": "standard"}})
    assert server.dance.builtin_slots() == before and server.dance.slot_sets == {}


@pytest.mark.parametrize("role,may", [("local", True), ("control", True), ("guest", False), ("eyes", False)])
def test_only_control_and_this_mac_adapt_and_change_slots(server, slots, saved_state, role, may):
    _talk(server, role, {"set": {"dance_ui": "slots"}}, {"dance_slots": {"op": "adapt", "name": "fire", "as": "Mine"}},
          {"dance_slots": {"op": "save", "name": "Mine", "slots": {"accents": [{"src": "g.wave", "fx": "pixel", "amt": 0.5}]}}},
          {"set": {"dance_set": "Mine"}})
    if may:
        assert server.dance.all_slots()["Mine"]["accents"][0] == {"src": "g.wave", "fx": "pixel", "amt": 0.5}
        assert server.dance.slot_use == "Mine" and server.dance.slots_msg()["rows"] == dance.compile_slots(server.dance.all_slots()["Mine"])
    else:
        assert server.dance.slot_sets == {} and server.dance.slot_use == "standard"


def test_switching_between_the_table_and_the_slots_loses_nothing(server, slots, saved_state):
    assert settings.SETTINGS["dance_ui"].default == "table"                     # as before, until the owner switches
    _talk(server, "control", {"dance_map": [GOOD_ROW]}, {"set": {"dance_ui": "slots"}}, {"set": {"dance_set": "waves"}},
          {"dance_slots": {"op": "adapt", "name": "waves", "as": "Mine"}}, {"set": {"dance_set": "Mine"}})
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
