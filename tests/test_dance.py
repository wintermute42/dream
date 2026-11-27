"""Dance steers the dream (#235): the mapping table (dance.py) – what a row may say, the file it is kept in, who may
change it over /ctl – and what the motion sensor hands to the stage's dance detection (sensors.py, inputs.py)."""
import asyncio
import json
import os
import re
import subprocess
import sys

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
    monkeypatch.setattr(dance, "_had_tables", False)
    return dance


def test_the_table_lives_with_the_owners_files_not_in_the_repository():
    assert dance.MAP_FILE == os.path.join(dance.paths.config_dir(), "dance.json")    # the sandbox's, in a test
    assert not dance.MAP_FILE.startswith(os.path.dirname(os.path.abspath(dance.__file__)))


def test_the_built_in_table_is_a_valid_table():
    rows = dance.default_tables()["dance"]
    assert dance.clean_rows(rows) == rows and len({r["id"] for r in rows}) == len(rows)
    # the story's ground rules: energy and opening steer an effect of the instant layer without any gesture, the
    # gestures have their effects, and no row moves a slow AI slider unasked (#265: the set Standard, compiled)
    by_src = {r["src"]: r for r in rows if r["origin"] == "slot" and r["dst"].startswith("fx.")}
    assert by_src["energy"]["dst"].startswith("fx.") and by_src["open"]["dst"].startswith("fx.")
    assert {"g.throw", "g.push", "g.circle", "g.wave"} <= set(by_src)
    assert not any(r["dst"].startswith("ai.") and r["on"] and r["dst"] != "ai.prompt" for r in rows)
    assert all(r["origin"] == "slot" for r in rows) and rows == dance.compile_slots(dance.SLOT_SETS["standard"])


def test_targets_are_the_instant_layer_and_the_ai_sliders():
    assert {"fx." + e for e in playlists.FX} <= set(dance.TARGETS)
    assert {"ai.strength", "ai.mix", "ai.zoom", "ai.rot", "ai.hue", "fx.amt", "fx.pulse", "fx.spin"} <= set(dance.TARGETS)
    # sliders that exist – and the two targets of #249 that are no slider: the prompt's energy words, the old reaction
    assert all(settings.SETTINGS[t[3:]].target for t in dance.TARGETS if t.startswith("ai.") and t not in ("ai.prompt", "ai.react", "ai.piece"))


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
    assert table.set_rows([GOOD, {"id": "bad", "src": "energy", "dst": "nowhere"}], "flowtrack") == [{**GOOD, "out": [0.0, 0.8]}]
    with open(table.MAP_FILE) as f:     # #265: the dance's table is not kept – it is its set's
        assert json.load(f) == {"version": 3, "tables": {"mood": built_in["mood"], "flowtrack": [{**GOOD, "out": [0.0, 0.8]}]}}
    assert table.load_tables()["flowtrack"] == [{**GOOD, "out": [0.0, 0.8]}]
    assert table.set_rows([], "flowtrack") == [] and table.load_tables()["flowtrack"] == []   # an empty table is a table: nothing steers
    assert table.set_rows("reset", "flowtrack") == built_in["flowtrack"] and not os.path.exists(table.MAP_FILE)
    assert table.set_rows(None, "flowtrack") == built_in["flowtrack"] and table.set_rows({"rows": []}, "flowtrack") == built_in["flowtrack"]   # not a table: nothing changes
    for broken in ("{not json", "[1, 2]", '{"rows": 7}', '{"tables": 7}', '{"tables": {"mood": 7}}', "[" * 100000):
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
    assert table.set_rows([GOOD], "dance") == built_in["dance"] and table.tables["dance"] == built_in["dance"]   # #265: its set's
    assert table.set_rows("reset", "mood") == built_in["mood"] and not os.path.exists(table.MAP_FILE)
    for rows in built_in.values():                                       # every built-in table is a valid table
        assert table.clean_rows(rows) == rows and len({r["id"] for r in rows}) == len(rows)


def test_the_presets_are_what_the_modes_are_for():
    """#249: the mood knows only energy and stillness – no gestures, nothing of the hands; flowtrack and the dance
    use the targets of the former direct interaction; the dance keeps its gestures."""
    t = dance.default_tables()
    assert {r["src"] for r in t["mood"]} == {"energy", "still"}
    mood = {r["dst"] for r in t["mood"] if r["on"]}
    assert {"fx.pulse", "fx.trails", "fx.speed", "ai.strength", "ai.prompt", "stage.calm"} == mood
    slow = [r for r in t["mood"] if r["dst"].startswith("ai.")]
    assert all(r["smooth"] >= 1.0 for r in slow), "the AI follows the mood gently"
    touch = {"touch.paint", "touch.warp", "touch.impulse", "touch.light", "touch.shape"}
    for mode in ("flowtrack", "dance"):
        assert touch | {"ai.prompt", "ai.react"} <= {r["dst"] for r in t[mode]}
        off = {r["dst"] for r in t[mode] if not r["on"]}
        assert off == {"touch.light", "ai.react"} | ({"touch.impulse"} if mode == "dance" else set()), "as the old cards were set (the dance: as its set Standard)"
    assert {"g.throw", "g.push", "g.circle", "g.wave"} <= {r["src"] for r in t["dance"]}   # Standard's four accents
    assert not any(r["src"].startswith("g.") for r in t["flowtrack"] + t["mood"])
    assert touch <= set(dance.TARGETS)


OLD_STATE = {"flowtrack": "hand", "dance": True, "motion": True, "motion_ai": True, "touch_paint": False,
             "touch_warp": True, "touch_impulse": False, "touch_light": True, "touch_content": False, "touch_amt": 0.4}


def test_the_switches_of_the_old_cards_become_rows_once(table):
    """#249: what was ticked in "Direct interaction" and "Movement" stays on, what was not stays off – carried over
    on the first start, and never again (a later start must not undo the owner's rows)."""
    assert table.adopt(OLD_STATE) is True
    on = {r["id"]: r["on"] for r in table.tables["flowtrack"]}
    assert (on["paint"], on["warp"], on["impulse"], on["light"], on["content"], on["react"]) == (False, True, False, True, False, True)
    assert table.tables["mood"] == table.default_tables()["mood"] and table.tables["dance"] == table.default_tables()["dance"]   # the dance's hands are its set's
    assert table.is_current() and table.load_tables() == table.tables
    table.set_rows([GOOD], "flowtrack")                                  # the owner changes the table …
    assert table.adopt(OLD_STATE) is False and table.tables["flowtrack"] == [{**GOOD, "out": [0.0, 0.8]}]   # … and keeps it
    assert table.set_rows("reset", "flowtrack")


@pytest.mark.parametrize("state", [{}, {"move_mode": "dance", "flowtrack": "hand", "touch_paint": False}, {"touch_paint": False}, None, []])
def test_a_state_of_today_or_without_the_switch_is_not_carried_over(table, state):
    assert table.adopt(state) is False and table.tables == table.default_tables() and not os.path.exists(table.MAP_FILE)


def test_react_needs_both_old_switches(table):
    assert table.adopt({**OLD_STATE, "motion": False})
    assert not table.row_on("flowtrack", "ai.react") and table.row_on("flowtrack", "touch.warp")


# ---------- who may change the table ----------
@pytest.mark.parametrize("role,may", [("local", True), ("control", True), ("guest", False), ("eyes", False)])
def test_only_control_and_this_mac_change_the_table(server, table, saved_state, role, may):
    assert server.dance is table                                           # the one table Dream holds
    seen = []
    with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
        assert ws.receive_json()["role"] == role
        ws.send_text(json.dumps({"dance_map": [GOOD], "mode": "mood"}))
        ws.send_text(json.dumps({"set": {"prompt": "after the table"}}))   # a marker both a guest and Control may send
        if role != "eyes":
            wait_until(lambda: server.hub.state["prompt"] == "after the table")
            for _ in range(12):                                             # everything the device was told on the way
                m = ws.receive_json()
                seen.append(m)
                if m.get("dance", {}).get("tables", {}).get("mood") == [{**GOOD, "out": [0.0, 0.8]}] or (not may and "dance" in m):
                    break
        else:
            ws.send_text(json.dumps({"feed": {"cam": False}}))
    if may:
        assert server.dance.tables["mood"] == [{**GOOD, "out": [0.0, 0.8]}] and os.path.exists(table.MAP_FILE)
        assert any(m.get("dance", {}).get("tables", {}).get("mood") == server.dance.tables["mood"] for m in seen), "everyone is told the new table"
    else:
        assert server.dance.tables == table.default_tables() and not os.path.exists(table.MAP_FILE)


@pytest.mark.parametrize("mode,lands", [("mood", "mood"), ("flowtrack", "flowtrack"), ("dance", None), ("party", None), (["mood"], None), (None, None)])
def test_a_table_is_changed_for_its_mode(server, table, saved_state, mode, lands):
    """#249: the page names the mode whose table it changed; the dance's (#265: its set's) or anything that is no mode
    changes nothing."""
    with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ws:
        assert ws.receive_json()["role"] == "control"
        ws.send_text(json.dumps({"dance_map": [GOOD], "mode": mode}))
        ws.send_text(json.dumps({"set": {"prompt": "after the table"}}))
        wait_until(lambda: server.hub.state["prompt"] == "after the table")
    built_in = table.default_tables()
    assert server.dance.tables == ({**built_in, lands: [{**GOOD, "out": [0.0, 0.8]}]} if lands else built_in)


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
    monkeypatch.setattr(server.inputs.sens, "source", server.inputs.SENDER_PHONES[0])               # the phone is another kind
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
    assert d["flow_markers"] is False and "flow_fingers" not in settings.SETTINGS   # #265: the hand model comes with Dream Dance
    # none of it is a guest's
    assert not {"move_mode", "move_off", "move_cam", "flow_markers", "marker_l", "marker_r"} & settings.GUEST_KEYS


def test_marker_colours_are_never_fire_colours():
    assert set(settings.MARKERS) == {"cyan", "magenta", "green", "blue"}
    assert settings.DEFAULT_STATE["marker_l"] != settings.DEFAULT_STATE["marker_r"]
    for bad in ("red", "orange", "yellow", ""):
        with pytest.raises(ValueError):
            settings.coerce("marker_l", bad)
    assert settings.coerce("flow_kind", "marker") == "marker"



# ---------- #251: the clutch and the movement sets ----------
def test_the_clutch_is_released_by_default_and_never_a_guests():
    assert settings.DEFAULT_STATE["clutch"] is False and settings.DEFAULT_STATE["dance_set"] == "standard"
    assert not {"clutch", "dance_set"} & settings.GUEST_KEYS


def test_every_start_has_the_clutch_released(tmp_path):
    """Dream starts with the dance's clutch released, whatever the last run left: it is engaged only on purpose."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = {**os.environ, "DREAM_STATE_DIR": str(tmp_path / "state"), "DREAM_CONFIG_DIR": str(tmp_path / "config"),
           "DREAM_SAVE_DIR": str(tmp_path / "save")}
    os.makedirs(env["DREAM_STATE_DIR"])
    with open(os.path.join(env["DREAM_STATE_DIR"], "state.json"), "w") as f:
        json.dump({"clutch": True, "move_mode": "dance", "dance_set": "waves"}, f)
    os.makedirs(env["DREAM_CONFIG_DIR"])
    with open(os.path.join(env["DREAM_CONFIG_DIR"], "dance.json"), "w") as f:   # #265: the set in use is kept with the sets
        json.dump({"version": 3, "slots": {"use": "fire", "sets": {}}}, f)
    out = subprocess.run([sys.executable, "-c", "import hub; print(hub.state['clutch'], hub.state['move_mode'], hub.state['dance_set'])"],
                         cwd=root, env=env, capture_output=True, text=True, timeout=60)
    assert out.stdout.split() == ["False", "dance", "fire"], out.stderr      # the mode and the set are remembered, the clutch is not


def test_the_pages_start_with_the_clutch_released_and_say_so():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for page in ("index.html", "remote.html", "dance.html"):
        with open(os.path.join(root, "static", page), encoding="utf-8") as f:
            html = f.read()
        (button,) = re.findall(r'<button[^>]*id="clutchbtn"[^>]*>[^<]*</button>', html)
        assert 'aria-pressed="false"' in button and button.endswith(">Clutch: released</button>") and "clutchbtn on" not in button, page
        assert re.search(r'</button>\s*<div class="clutchnote" id="clutchnote" role="status"[^>]*>Released: your dance does nothing yet', html), page
        assert not re.search(r'id="clutch"[^>]*checked', html), page
        assert "MoveCard.clutchShow(" in html, page
    with open(os.path.join(root, "static", "movecard.css"), encoding="utf-8") as f:
        assert '#clutchbtn[aria-pressed="false"]' in f.read()                # released looks different, not just reads different


@pytest.mark.parametrize("name,ok", [("waves", True), ("My set 1", True), ("Fire+Water", True), ("a.b-c", True), ("Élan 2", True),
                                     ("", True), (" lead", False), ("x" * 33, False), ("Waves – mine", True), ("a/b", False), ("../x", False),
                                     ("a\nb", False), ("<b>", False), ("_x", False)])
def test_a_sets_name_is_a_short_plain_name(name, ok):
    assert settings.coerce("dance_set", name) == (name if ok else "")
    if name:                                                             # the setting and the sets have the one rule
        assert (dance.clean_slot_name(name) == name) is ok


def test_the_midi_button_walks_through_the_sets_and_a_scene_can_choose_one(server, table, saved_state, monkeypatch):
    monkeypatch.setattr(server.dance, "slot_use", "standard")
    assert {"clutch", "dance_set"} <= set(server.inputs.midi.ACTIONS)
    assert server.inputs.next_set("") == "waves"                         # from the one in use
    # whatever sets the setting – a MIDI button, a playlist scene, a page – makes the set the table
    asyncio.run(server.hub.apply({"dance_set": "waves"}))
    assert server.dance.tables["dance"] == dance.compile_slots(dance.SLOT_SETS["waves"])
    assert [server.inputs.next_set(n) for n in ("", "gone")] == ["fire", "fire"]
    asyncio.run(server.hub.apply({"dance_set": "no such set"}))          # a name that is no set changes nothing
    assert server.dance.tables["dance"] == dance.compile_slots(dance.SLOT_SETS["waves"])
    asyncio.run(server.hub.apply({"dance_set": "standard"}))
    assert "dance_set" in server.settings.DEFAULT_STATE                  # so a scene's settings may carry it (scenes.py)


# ---------- #270: the room light's LED chain as effects of the sentences ----------
def test_the_room_lights_effects_are_sentences_in_their_lane_and_in_no_group():
    s = {"base": [{"src": "energy", "fx": "led.level", "amt": 1.0}, {"src": "open", "fx": "kaleido", "amt": 0.5}],
         "accents": [{"src": "g.throw", "fx": "led.flash", "amt": 0.5, "tol": "normal"},
                     {"src": "g.push", "fx": "led.chase", "amt": 0.0, "tol": "normal"},
                     {"src": "g.wave", "fx": "mandala", "amt": 1.0, "tol": "normal"}, None], "hands": []}
    kept = dance.clean_slots(s)
    assert [x and x["fx"] for x in kept["base"]] == ["led.level", "kaleido"]
    assert [x and x["fx"] for x in kept["accents"]] == ["led.flash", "led.chase", None, None]   # mandala: kaleido's group
    # the flash and the pulse are an accent's, the brightness a base movement's: elsewhere they are dropped
    wrong = dance.clean_slots({"base": [{"src": "energy", "fx": "led.flash", "amt": 1.0}],
                               "accents": [{"src": "g.throw", "fx": "led.level", "amt": 1.0, "tol": "normal"}], "hands": ["paint"]})
    assert wrong["base"] == [None, None] and wrong["accents"] == [None] * 4
    assert dance.slot_conflict(kept, "base", 0, "led.chase") == "lane"
    assert dance.slot_conflict(kept, "accents", 3, "led.flash") == "taken"
    # the brightness in the base lane takes no group from an accent's effect – any picture effect fits beside it
    assert all(dance.slot_conflict({"base": [kept["base"][0], None], "accents": [None] * 4}, "accents", 0, fx) is None
               for fx in playlists.FX)


def test_the_room_lights_sentences_compile_to_its_targets():
    rows = {r["id"]: r for r in dance.compile_slots(dance.clean_slots({
        "base": [{"src": "energy", "fx": "led.level", "amt": 0.5}, None],
        "accents": [{"src": "g.throw", "fx": "led.flash", "amt": 1.0, "tol": "normal"},
                    {"src": "g.push", "fx": "led.chase", "amt": 0.0, "tol": "loose"}, None, None], "hands": []}))}
    assert dance.clean_rows(list(rows.values())) == list(rows.values())
    # the brightness: dimmed by the sentence's strength while calm, none while wild – and none while nobody is seen
    assert rows["base0"]["dst"] == "led.level" and rows["base0"]["out"] == [-dance.peak(0.5), 0.0]
    # the flash and the pulse follow the gesture at once, as strong as the sentence says
    assert (rows["accent0"]["dst"], rows["accent0"]["out"], rows["accent0"]["smooth"]) == ("led.flash", [0.0, 1.0], 0.0)
    assert (rows["accent1"]["dst"], rows["accent1"]["out"][1]) == ("led.chase", dance.SLOT_MIN)
    assert {"led.flash", "led.chase", "led.level"} <= set(dance.TARGETS)
    assert not set(dance.LED_LANE) & set(dance.GROUP_OF)
