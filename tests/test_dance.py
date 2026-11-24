"""Dance steers the dream (#235): the mapping table (dance.py) – what a row may say, the file it is kept in, who may
change it over /ctl – and what the motion sensor hands to the stage's dance detection (sensors.py, inputs.py)."""
import asyncio
import json
import os

import pytest

import dance
import playlists
import sensors
import settings
from test_rights import client, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401  (the roles' devices; nothing left behind)


@pytest.fixture
def table(monkeypatch):
    """The table Dream holds comes back afterwards (its file is the sandbox's: conftest)."""
    monkeypatch.setattr(dance, "tables", dance.default_tables())
    return dance


def test_the_table_lives_with_the_owners_files_not_in_the_repository():
    assert dance.MAP_FILE == os.path.join(dance.paths.config_dir(), "dance.json")    # the sandbox's, in a test
    assert not dance.MAP_FILE.startswith(os.path.dirname(os.path.abspath(dance.__file__)))


def test_the_built_in_table_is_a_valid_table():
    assert dance.clean_rows(dance.DEFAULT_ROWS) == dance.DEFAULT_ROWS
    assert len({r["id"] for r in dance.DEFAULT_ROWS}) == len(dance.DEFAULT_ROWS)
    # the story's ground rules: energy and opening steer an effect of the instant layer without any gesture, every
    # built-in gesture has its effect, and no row moves a slow AI slider unasked
    by_src = {r["src"]: r for r in dance.DEFAULT_ROWS}
    assert by_src["energy"]["dst"].startswith("fx.") and by_src["open"]["dst"].startswith("fx.")
    assert {"g.throw", "g.accordion", "g.push", "g.circle", "g.wave"} <= set(by_src)
    assert not any(r["dst"].startswith("ai.") for r in dance.DEFAULT_ROWS)
    assert all(r["on"] and r["origin"] == "fixed" for r in dance.DEFAULT_ROWS)


def test_targets_are_the_instant_layer_and_the_ai_sliders():
    assert {"fx." + e for e in playlists.FX} <= set(dance.TARGETS)
    assert {"ai.strength", "ai.mix", "ai.zoom", "ai.rot", "ai.hue", "fx.amt", "fx.pulse", "fx.spin"} <= set(dance.TARGETS)
    # sliders that exist – and the two targets of #249 that are no slider: the prompt's energy words, the old reaction
    assert all(settings.SETTINGS[t[3:]].target for t in dance.TARGETS if t.startswith("ai.") and t not in ("ai.prompt", "ai.react"))


GOOD = {"id": "a1", "on": True, "src": "l.palm", "dst": "fx.kaleido", "curve": "soft", "in": [0.2, 0.9], "out": [0, 0.8],
        "smooth": 0.3, "origin": "own"}


def test_a_row_keeps_what_it_may_say():
    assert dance.clean_row(GOOD) == {**GOOD, "out": [0.0, 0.8]}
    # what is left out gets its default; a source nobody knows yet (a taught gesture, a glove) is a name like any other
    assert dance.clean_row({"id": "b", "src": "own.spiral_3", "dst": "ai.hue"}) == {
        "id": "b", "on": True, "src": "own.spiral_3", "dst": "ai.hue", "curve": "lin", "in": [0.0, 1.0], "out": [0.0, 1.0],
        "smooth": 0.15, "origin": "own"}
    # numbers are held inside their ranges
    r = dance.clean_row({**GOOD, "in": [-7, 9], "out": [-3, 3], "smooth": 99})
    assert (r["in"], r["out"], r["smooth"]) == ([-1.0, 1.0], [-1.0, 1.0], 5.0)
    assert dance.clean_row({**GOOD, "curve": "zigzag"})["curve"] == "lin"
    assert dance.clean_row({**GOOD, "origin": "someone"})["origin"] == "own"


@pytest.mark.parametrize("change", [
    {"dst": "fx.strobe"}, {"dst": "ai.model"}, {"dst": "set.master"}, {"dst": ["fx.waves"]}, {"dst": None},
    {"src": "../etc"}, {"src": "Energy"}, {"src": "a.b.c"}, {"src": ""}, {"src": 3}, {"src": "x" * 80},
    {"id": ""}, {"id": "has space"}, {"id": 7}, {"id": "x" * 40},
    {"in": [0]}, {"in": "0,1"}, {"in": [0, float("nan")]}, {"in": [0, float("inf")]}, {"in": [0, 10 ** 400]}, {"in": [True, 1]},
    {"out": [None, 1]}, {"out": {"a": 1}}, {"smooth": "fast"}, {"smooth": float("nan")}, {"smooth": [1]},
])
def test_a_row_that_says_something_else_is_dropped(change):
    assert dance.clean_row({**GOOD, **change}) is None


@pytest.mark.parametrize("odd", [None, True, 3, "rows", {}, [[]], [None, 3, "x"], [{"id": {}}], {"rows": 1}])
def test_a_table_of_anything_else_is_an_empty_table(odd):
    assert dance.clean_rows(odd) == []


def test_a_table_has_each_row_once_and_an_end():
    rows = dance.clean_rows([GOOD, {**GOOD, "dst": "fx.waves"}, {**GOOD, "id": "a2"}])
    assert [(r["id"], r["dst"]) for r in rows] == [("a1", "fx.kaleido"), ("a2", "fx.kaleido")]
    assert len(dance.clean_rows([{**GOOD, "id": f"r{i}"} for i in range(500)])) == dance.MAX_ROWS


def test_the_table_is_kept_in_one_file_and_comes_back(table):
    built_in = table.default_tables()
    assert table.load_tables() == built_in                              # no file: the built-in tables
    assert table.set_rows([GOOD, {"id": "bad", "src": "energy", "dst": "nowhere"}]) == [{**GOOD, "out": [0.0, 0.8]}]
    with open(table.MAP_FILE) as f:
        assert json.load(f) == {"version": 2, "tables": {**built_in, "dance": [{**GOOD, "out": [0.0, 0.8]}]}}
    assert table.load_tables()["dance"] == [{**GOOD, "out": [0.0, 0.8]}]
    assert table.set_rows([]) == [] and table.load_tables()["dance"] == []   # an empty table is a table: nothing steers
    assert table.set_rows("reset") == built_in["dance"] and not os.path.exists(table.MAP_FILE)
    assert table.set_rows(None) == built_in["dance"] and table.set_rows({"rows": []}) == built_in["dance"]   # not a table: nothing changes
    for broken in ("{not json", "[1, 2]", '{"rows": 7}', '{"tables": 7}', '{"tables": {"dance": 7}}', "[" * 100000):
        with open(table.MAP_FILE, "w") as f:
            f.write(broken)
        assert table.load_tables() == built_in, broken


def test_every_mode_has_its_own_table(table):
    """#249: a mode is a preset of the table – changing one mode's rows leaves the others alone, and a mode nobody
    knows has no table."""
    built_in = table.default_tables()
    assert set(built_in) == set(table.MODES) == set(settings.MOVE_MODES) - {"off"}
    assert table.set_rows([GOOD], "mood") == [{**GOOD, "out": [0.0, 0.8]}]
    assert table.tables["dance"] == built_in["dance"] and table.tables["flowtrack"] == built_in["flowtrack"]
    assert table.load_tables()["mood"] == [{**GOOD, "out": [0.0, 0.8]}]
    assert table.set_rows([GOOD], "party") == [] and table.set_rows([GOOD], "off") == []
    assert table.set_rows("reset", "mood") == built_in["mood"] and not os.path.exists(table.MAP_FILE)
    for rows in built_in.values():                                       # every built-in table is a valid table
        assert table.clean_rows(rows) == rows and len({r["id"] for r in rows}) == len(rows)


def test_the_presets_are_what_the_modes_are_for():
    """#249: the mood knows only energy and stillness – no gestures, nothing of the hands; flowtrack and the dance
    use the targets of the former direct interaction; the dance keeps its gestures."""
    t = dance.DEFAULT_TABLES
    assert {r["src"] for r in t["mood"]} == {"energy", "still"}
    mood = {r["dst"] for r in t["mood"] if r["on"]}
    assert {"fx.pulse", "fx.trails", "fx.speed", "ai.strength", "ai.prompt", "stage.calm"} == mood
    slow = [r for r in t["mood"] if r["dst"].startswith("ai.")]
    assert all(r["smooth"] >= 1.0 for r in slow), "the AI follows the mood gently"
    touch = {"touch.paint", "touch.warp", "touch.impulse", "touch.light", "touch.shape"}
    for mode in ("flowtrack", "dance"):
        assert touch | {"ai.prompt", "ai.react"} <= {r["dst"] for r in t[mode]}
        off = {r["dst"] for r in t[mode] if not r["on"]}
        assert off == {"touch.light", "ai.react"}, "as the old cards were set"
    assert {"g.throw", "g.accordion", "g.push", "g.circle", "g.wave"} <= {r["src"] for r in t["dance"]}
    assert not any(r["src"].startswith("g.") for r in t["flowtrack"] + t["mood"])
    assert touch <= set(dance.TARGETS)


def test_a_table_of_the_version_before_the_modes_is_the_dance_table(table):
    """#249: `dance.json` of #235 held one table. It is the dance's; the rows of the direct interaction join it."""
    os.makedirs(os.path.dirname(table.MAP_FILE), exist_ok=True)
    with open(table.MAP_FILE, "w") as f:
        json.dump({"version": 1, "rows": [GOOD]}, f)
    got = table.load_tables()
    assert got["dance"][0] == {**GOOD, "out": [0.0, 0.8]}
    assert [r["id"] for r in got["dance"][1:]] == [r["id"] for r in table.TOUCH_ROWS]
    assert got["mood"] == table.default_tables()["mood"] and not table.is_current()


OLD_STATE = {"flowtrack": "hand", "dance": True, "motion": True, "motion_ai": True, "touch_paint": False,
             "touch_warp": True, "touch_impulse": False, "touch_light": True, "touch_content": False, "touch_amt": 0.4}


def test_the_switches_of_the_old_cards_become_rows_once(table):
    """#249: what was ticked in "Direct interaction" and "Movement" stays on, what was not stays off – carried over
    on the first start, and never again (a later start must not undo the owner's rows)."""
    assert table.adopt(OLD_STATE) is True
    for mode in ("flowtrack", "dance"):
        on = {r["id"]: r["on"] for r in table.tables[mode]}
        assert (on["paint"], on["warp"], on["impulse"], on["light"], on["content"], on["react"]) == (False, True, False, True, False, True)
    assert table.tables["mood"] == table.default_tables()["mood"]
    assert table.is_current() and table.load_tables() == table.tables
    table.set_rows([GOOD], "dance")                                      # the owner changes the table …
    assert table.adopt(OLD_STATE) is False and table.tables["dance"] == [{**GOOD, "out": [0.0, 0.8]}]   # … and keeps it
    assert table.set_rows("reset", "dance") and table.set_rows("reset", "flowtrack")


@pytest.mark.parametrize("state", [{}, {"move_mode": "dance", "flowtrack": "hand", "touch_paint": False}, {"touch_paint": False}, None, []])
def test_a_state_of_today_or_without_the_switch_is_not_carried_over(table, state):
    assert table.adopt(state) is False and table.tables == table.default_tables() and not os.path.exists(table.MAP_FILE)


def test_react_needs_both_old_switches(table):
    assert table.adopt({**OLD_STATE, "motion": False})
    assert not table.row_on("dance", "ai.react") and table.row_on("dance", "touch.warp")


# ---------- who may change the table ----------
@pytest.mark.parametrize("role,may", [("local", True), ("control", True), ("guest", False), ("eyes", False)])
def test_only_control_and_this_mac_change_the_table(server, table, saved_state, role, may):
    assert server.dance is table                                           # the one table Dream holds
    seen = []
    with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
        assert ws.receive_json()["role"] == role
        ws.send_text(json.dumps({"dance_map": [GOOD]}))
        ws.send_text(json.dumps({"set": {"prompt": "after the table"}}))   # a marker both a guest and Control may send
        if role != "eyes":
            wait_until(lambda: server.hub.state["prompt"] == "after the table")
            for _ in range(12):                                             # everything the device was told on the way
                m = ws.receive_json()
                seen.append(m)
                if m.get("dance", {}).get("map") == [{**GOOD, "out": [0.0, 0.8]}] or (not may and "dance" in m):
                    break
        else:
            ws.send_text(json.dumps({"feed": {"cam": False}}))
    if may:
        assert server.dance.tables["dance"] == [{**GOOD, "out": [0.0, 0.8]}] and os.path.exists(table.MAP_FILE)
        assert any(m.get("dance", {}).get("map") == server.dance.tables["dance"] for m in seen), "everyone is told the new table"
    else:
        assert server.dance.tables == table.default_tables() and not os.path.exists(table.MAP_FILE)


@pytest.mark.parametrize("mode,lands", [("mood", "mood"), ("flowtrack", "flowtrack"), ("party", "dance"), (["mood"], "dance"), (None, "dance")])
def test_a_table_is_changed_for_its_mode(server, table, saved_state, mode, lands):
    """#249: the page names the mode whose table it changed; anything that is no mode means the dance table."""
    with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ws:
        assert ws.receive_json()["role"] == "control"
        ws.send_text(json.dumps({"dance_map": [GOOD], "mode": mode}))
        ws.send_text(json.dumps({"set": {"prompt": "after the table"}}))
        wait_until(lambda: server.hub.state["prompt"] == "after the table")
    built_in = table.default_tables()
    assert server.dance.tables == {**built_in, lands: [{**GOOD, "out": [0.0, 0.8]}]}


def test_a_device_is_told_the_table_when_it_connects(server, table):
    with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ws:
        got = [ws.receive_json() for _ in range(7)]
    assert any(m.get("dance", {}).get("map") == table.default_tables()["dance"] for m in got)
    assert any(m.get("dance", {}).get("tables") == table.default_tables() for m in got)   # #249: every mode's table
    with client(server, "eyes").websocket_connect(ws_url(server, "/ctl", "eyes")) as ws:   # the eyes learn nothing of it
        got = [ws.receive_json() for _ in range(2)]
    assert not any("dance" in m for m in got)


# ---------- the motion sensor's part ----------
def test_the_sensor_hands_the_gyroscope_on_as_it_came_and_only_while_fresh():
    s = sensors.Sensors()
    assert s.motion(now=1.0) is None
    s.on_osc("/device/gyroscope", [0.5, -2.25, 0.125], now=10.0)
    assert s.motion(now=10.1) == {"g": [0.5, -2.25, 0.125], "age": 0.1}
    assert s.motion(now=10.5) is None                                   # nothing for a third of a second: no sensor
    s.on_osc("/rotation_rate", [1.0], now=11.0)                         # fewer axes: the rest is 0
    assert s.motion(now=11.0)["g"] == [1.0, 0.0, 0.0]
    s.on_osc("/device/accelerometer", [0.0, 0.0, 9.81], now=11.2)       # no gyroscope: nothing new for the dance
    assert s.motion(now=11.2)["age"] == 0.2


def test_a_button_is_one_press_however_long_it_is_held():
    s = sensors.Sensors()
    for i, v in enumerate([0, 1, 1, 1, 0, 0, 1, 0]):
        s.on_osc("/band/1/btn", [v], now=20 + i * 0.05)
    s.on_osc("/band/1/button_b", [1.0], now=21.0)
    assert [e for e in s.events if e[0] == "button"] == [("button", 0), ("button", 0), ("button", 1)]
    for i in range(20):                                                 # more buttons than a wristband has: not kept
        s.on_osc(f"/x/btn{i}", [1], now=22 + i)
    assert len(s.buttons) == 8


def test_the_stage_gets_the_sensor_only_while_a_mode_listens_to_it(server, monkeypatch):
    sent = []

    async def broadcast(msg, exclude=None, only=None):
        sent.append((msg, only))
    monkeypatch.setattr(server.hub, "broadcast", broadcast)
    monkeypatch.setattr(server.inputs.sens, "motion", lambda now=None: {"g": [1.0, 2.0, 3.0], "age": 0.01})
    monkeypatch.setattr(server.inputs.sens, "source", "192.0.2.7")                              # a wristband over OSC
    monkeypatch.setitem(server.hub.state, "move_off", "")
    monkeypatch.setitem(server.hub.state, "move_mode", "dance")
    asyncio.run(server.inputs.sensor_dance())
    assert sent == [({"sensors": {"dance": {"g": [1.0, 2.0, 3.0], "age": 0.01}}}, "stage")]     # the stage only
    monkeypatch.setitem(server.hub.state, "move_mode", "off")                                   # #249: no mode, no movement
    asyncio.run(server.inputs.sensor_dance())
    assert len(sent) == 1
    monkeypatch.setitem(server.hub.state, "move_mode", "mood")                                  # the mood listens to it too
    asyncio.run(server.inputs.sensor_dance())
    assert len(sent) == 2
    monkeypatch.setitem(server.hub.state, "move_off", "band")                                   # … unless it is switched off
    asyncio.run(server.inputs.sensor_dance())
    assert len(sent) == 2
    monkeypatch.setattr(server.inputs.sens, "source", server.inputs.SENDER_PHONE)               # the phone is another kind
    asyncio.run(server.inputs.sensor_dance())
    assert len(sent) == 3
    monkeypatch.setattr(server.inputs.sens, "motion", lambda now=None: None)                    # no sensor: nothing sent
    asyncio.run(server.inputs.sensor_dance())
    assert len(sent) == 3


# ---------- the settings ----------
def test_movement_is_off_and_the_slow_sliders_are_left_alone_by_default():
    d = settings.DEFAULT_STATE
    assert d["move_mode"] == "off" and d["move_off"] == "" and d["move_cam"] is False
    assert not dance.row_on("dance", "ai.react") and not dance.row_on("flowtrack", "ai.react")
    assert d["flow_markers"] is False and d["flow_fingers"] is False
    # none of it is a guest's
    assert not {"move_mode", "move_off", "move_cam", "flow_markers", "flow_fingers", "marker_l", "marker_r"} & settings.GUEST_KEYS


def test_marker_colours_are_never_fire_colours():
    assert set(settings.MARKERS) == {"cyan", "magenta", "green", "blue"}
    assert settings.DEFAULT_STATE["marker_l"] != settings.DEFAULT_STATE["marker_r"]
    for bad in ("red", "orange", "yellow", ""):
        with pytest.raises(ValueError):
            settings.coerce("marker_l", bad)
    assert settings.coerce("flow_kind", "marker") == "marker"

