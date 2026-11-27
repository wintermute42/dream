"""The movement engine in Dream itself (#249): the modes as presets, the register of the sources that are not in the
stage (movement.py), what Dreamy Eyes may say of the movement in front of them (ctl.py), the senders of sensor values
as sources (sensors.py, inputs.py), and the settings of earlier versions carried over (settings.moved)."""
import asyncio
import json
import os
import time

import pytest

import dance
import movement
import sensors
import settings
from test_rights import client, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401  (the roles' devices; nothing left behind)


def state(**changes) -> dict:
    return {**settings.DEFAULT_STATE, **changes}


# ---------- the modes ----------
def test_the_modes_are_one_list_everywhere():
    assert tuple(movement.MODES) == settings.MOVE_MODES == ("off", "mood", "flowtrack", "dance")
    assert set(dance.MODES) == set(settings.MOVE_MODES) - {"off"}                # every mode but "off" has its table
    assert settings.SETTINGS["move_mode"].choices == settings.MOVE_MODES      # one setting: the modes exclude each other
    assert not any("window" in k for k in settings.MOVE_SOURCES)                # dream windows are no source


def test_the_macs_camera_runs_only_for_a_mode_that_needs_it():
    assert not movement.camera_on(state())                                       # off: no camera
    assert movement.camera_on(state(move_mode="flowtrack")) and movement.camera_on(state(move_mode="dance"))
    assert not movement.camera_on(state(move_mode="mood"))                      # the mood runs without it …
    assert movement.camera_on(state(move_mode="mood", move_cam=True))           # … unless asked
    assert not movement.camera_on(state(move_mode="off", move_cam=True))
    assert not movement.camera_on(state(move_mode="dance", move_off="camera"))  # switched off is off
    assert not movement.camera_on(state(move_mode="who-knows"))                 # fail closed


def test_a_mode_listens_only_to_its_sources():
    mood, flow = state(move_mode="mood"), state(move_mode="flowtrack")
    assert [k for k in settings.MOVE_SOURCES if movement.uses(mood, k)] == ["eyes", "phone", "band"]
    assert [k for k in settings.MOVE_SOURCES if movement.uses(flow, k)] == ["camera", "phone", "band"]   # the eyes: the mood's
    assert not any(movement.uses(state(), k) for k in settings.MOVE_SOURCES)
    assert not movement.uses(state(move_mode="mood", move_off="eyes+band"), "eyes")
    assert movement.uses(state(move_mode="mood", move_off="eyes+band"), "phone")


def test_the_switched_off_sources_are_known_kinds_each_once():
    assert settings.coerce("move_off", "band+eyes+band+window+../x") == "band+eyes"
    assert settings.coerce("move_off", "") == "" and settings.coerce("move_off", "nothing") == ""
    assert movement.off_kinds({"move_off": None}) == set() and movement.off_kinds({}) == set()


# ---------- the register ----------
def test_a_source_has_a_name_a_kind_and_a_state():
    reg, st = movement.Sources(), state(move_mode="mood")
    for i in range(11):                                                          # five values a second for two seconds
        assert reg.report("eyes:1", "eyes", "Dreamy Eyes 1", 0.4, 0.8, now=100 + i * 0.2)
    (s,) = reg.listing(st, now=102.1)
    assert s == {"id": "eyes:1", "kind": "eyes", "name": "Dreamy Eyes 1", "on": True, "used": True, "active": True,
                 "rate": 5.0, "conf": 0.8, "energy": 0.4}
    (s,) = reg.listing(st, now=102.0 + movement.FRESH + 0.1)                     # silent: it says so, and keeps no energy
    assert (s["active"], s["rate"], s["conf"], s["energy"]) == (False, 0.0, 0.0, 0.0)
    assert reg.listing(st, now=102.0 + movement.GONE + 1) == []                  # and after a while it is gone
    assert reg.report("eyes:1", "eyes", "Dreamy Eyes 1", 0.4, now=200) and reg.listing(state(move_off="eyes"), now=200)[0]["on"] is False
    assert reg.listing(state(move_mode="dance"), now=200)[0]["used"] is False    # the dance does not listen to the eyes
    reg.drop("eyes:1")
    assert reg.listing(st, now=200) == []


@pytest.mark.parametrize("energy,conf", [(None, 1), ("0.5", 1), (True, 1), (float("nan"), 1), (float("inf"), 1), (10 ** 400, 1),
                                         ([0.5], 1), ({}, 1), (0.5, None), (0.5, "x"), (0.5, float("nan")), (0.5, [1])])
def test_a_value_that_is_no_number_is_not_taken(energy, conf):
    reg = movement.Sources()
    assert reg.report("eyes:1", "eyes", "x", energy, conf, now=1) is False and reg.items == {}


def test_values_are_held_in_their_range_and_kinds_and_the_list_have_an_end():
    reg = movement.Sources()
    assert reg.report("a", "eyes", "n" * 500, 7, -3, now=1)
    assert (reg.items["a"]["energy"], reg.items["a"]["conf"], len(reg.items["a"]["name"])) == (1.0, 0.0, 40)
    assert reg.report("b", "window", "a dream window", 0.5, now=1) is False      # no such kind of source
    for i in range(100):
        reg.report(f"e{i}", "eyes", "x", 0.1, now=1)
    assert len(reg.items) == movement.MAX_SOURCES
    assert reg.report("late", "eyes", "x", 0.1, now=2 + movement.GONE)           # the silent ones make room


def test_the_rooms_energy_is_a_mean_weighted_by_confidence():
    src = lambda e, c, **k: {"energy": e, "conf": c, "active": True, "used": True, **k}   # noqa: E731
    assert movement.room_energy([]) == (0.0, 0.0)
    e, c = movement.room_energy([src(0.8, 1.0), src(0.2, 1.0)])
    assert e == pytest.approx(0.5) and c == pytest.approx(1.0)
    e, c = movement.room_energy([src(1.0, 0.1), src(0.0, 0.9)])                  # an unsure wild one does not rule a calm room
    assert e == pytest.approx(0.1) and c == pytest.approx(0.91)
    quiet = [src(0.05, 0.8) for _ in range(5)]
    assert movement.room_energy(quiet + [src(1.0, 0.8)])[0] < 0.25               # one lively phone among five quiet ones
    # what is silent, switched off or not the mode's does not count
    assert movement.room_energy([src(1.0, 1.0, active=False), src(1.0, 1.0, used=False), src(1.0, 0.0), src(0.3, 0.5)])[0] == pytest.approx(0.3)


# ---------- Dreamy Eyes: a number, never a picture ----------
@pytest.fixture
def register(server, monkeypatch):
    monkeypatch.setattr(server.movement, "sources", movement.Sources())
    monkeypatch.setattr(server.ctl, "eyes_ids", {})
    return server.movement.sources


def test_dreamy_eyes_report_their_energy_and_nothing_else(server, register, saved_state):
    server.hub.state.update(move_mode="mood", move_off="", prompt="before")
    with client(server, "eyes").websocket_connect(ws_url(server, "/ctl", "eyes")) as ws:
        assert ws.receive_json()["role"] == "eyes"
        ws.send_text(json.dumps({"move": {"e": 0.6, "c": 0.9, "picture": "x" * 100, "name": "someone"},
                                 "set": {"prompt": "from the eyes", "move_mode": "off"}, "dance_map": []}))
        wait_until(lambda: register.items)
        (item,) = register.items.values()
        assert (item["kind"], item["energy"], item["conf"]) == ("eyes", 0.6, 0.9)
        assert set(item) == {"kind", "name", "at", "energy", "conf", "n", "rate", "since"}   # nothing of the person, no picture
        assert item["name"].startswith("Dreamy Eyes ")
        assert server.hub.state["prompt"] == "before" and server.hub.state["move_mode"] == "mood"   # the eyes set nothing
        assert server.dance.tables == server.dance.default_tables()
        for odd in ([], "x", None, 3, {"e": "0.5"}, {"e": [1]}, {"c": 1}, {"e": float("inf")}):
            ws.send_text(json.dumps({"move": odd}))
        ws.send_text(json.dumps({"move": {"e": 0.6}, "seen": "last"}))
    wait_until(lambda: not register.items)                                       # gone with the page
    assert server.ctl.eyes_ids == {}


def test_only_dreamy_eyes_pages_are_eyes(server, register, saved_state):
    """A guest (or Dream Control as a remote) cannot pose as a pair of eyes: `move` is read from Dreamy Eyes pages only."""
    for role in ("guest", "control"):
        with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
            assert ws.receive_json()["role"] == role
            ws.send_text(json.dumps({"move": {"e": 1.0, "c": 1.0}}))
            ws.send_text(json.dumps({"set": {"prompt": "mark " + role}}))
            wait_until(lambda: server.hub.state["prompt"] == "mark " + role)
        assert register.items == {}, role


def test_a_device_is_told_the_sources_but_the_eyes_are_not(server, register, saved_state):
    register.report("eyes:9", "eyes", "Dreamy Eyes 9", 0.3, 0.7)
    with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ws:
        got = [ws.receive_json() for _ in range(7)]
    (told,) = [m["move"] for m in got if "move" in m]
    assert [s["id"] for s in told["sources"]] == ["eyes:9"]
    with client(server, "eyes").websocket_connect(ws_url(server, "/ctl", "eyes")) as ws:
        got = [ws.receive_json() for _ in range(2)]
    assert not any("move" in m for m in got)


# ---------- phones and wristbands ----------
def test_every_sender_of_sensor_values_is_a_source(server, register, monkeypatch):
    sens = sensors.Sensors()
    monkeypatch.setattr(server.inputs, "sens", sens)
    monkeypatch.setattr(server.inputs, "sources_told", {"msg": None})
    monkeypatch.setitem(server.hub.state, "move_mode", "dance")
    monkeypatch.setitem(server.hub.state, "move_off", "")
    sent = []

    async def broadcast(msg, exclude=None, only=None):
        sent.append(msg)
    monkeypatch.setattr(server.hub, "broadcast", broadcast)
    for _ in range(20):
        sens.on_osc("/device/gyroscope", [4.0, 0.0, 0.0], server.inputs.SENDER_PHONES[0])
        sens.on_osc("/band/gyro", [0.0, 8.0, 0.0], "192.0.2.7")
        sens.on_osc("/band/accelerometer", [0.0, 9.8, 0.0], "192.0.2.7")       # no swing: it changes nothing of the energy
    asyncio.run(server.inputs.sources_tell())
    by = {s["id"]: s for s in sent[-1]["move"]["sources"]}
    assert set(by) == {"phone:Dream Control", "band:192.0.2.7"}
    assert by["phone:Dream Control"]["kind"] == "phone" and by["band:192.0.2.7"]["kind"] == "band"
    assert by["phone:Dream Control"]["energy"] == pytest.approx(0.5, abs=0.01) and by["band:192.0.2.7"]["energy"] == pytest.approx(1.0, abs=0.01)
    assert all(s["active"] and s["used"] and s["on"] for s in by.values())
    asyncio.run(server.inputs.sources_tell())
    assert len(sent) == 1                                                        # told only when something changed
    monkeypatch.setitem(server.hub.state, "move_off", "band")
    asyncio.run(server.inputs.sources_tell())
    assert {s["id"]: s["on"] for s in sent[-1]["move"]["sources"]} == {"phone:Dream Control": True, "band:192.0.2.7": False}


def test_the_senders_have_an_end():
    sens = sensors.Sensors()
    for i in range(50):
        sens.on_osc("/x/gyro", [1.0, 1.0, 1.0], f"192.0.2.{i}")
    assert len(sens.by) == 8


def test_rules_count_only_while_the_camera_runs_and_the_camera_never_says_who_is_there(server, monkeypatch, saved_state):
    seen, here = [], []

    async def note(*a):
        seen.append(a)

    async def presence(*a):
        here.append(a)
    monkeypatch.setattr(server.inputs, "on_presence", presence)
    monkeypatch.setattr(server.inputs, "on_rule", note)
    for mode, cam, counts in (("off", False, 0), ("mood", False, 0), ("mood", True, 1), ("dance", False, 1), ("flowtrack", False, 1)):
        seen.clear()
        server.hub.state.update(move_mode=mode, move_cam=cam, move_off="", prompt="")
        with client(server, "local").websocket_connect(ws_url(server, "/ctl", "local") + "?role=stage") as ws:
            assert ws.receive_json()["role"] == "local"
            ws.send_text(json.dumps({"moved": True, "rule": "Fire on"}))
            ws.send_text(json.dumps({"moved": False}))
            ws.send_text(json.dumps({"set": {"prompt": "mark"}}))
            wait_until(lambda: server.hub.state["prompt"] == "mark")
        assert len(seen) == counts, (mode, cam)
        assert here == [], (mode, cam)             # the stage's camera: neither "nobody there" nor "someone came"
    for page in ("index.html", "motion.js"):       # … and the page does not even report it
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", page), encoding="utf-8") as f:
            assert "onPresence" not in f.read(), page


# ---------- nobody there, someone comes: Dreamy Eyes' alone ----------
def eyes_src(energy, **more):
    return {"kind": "eyes", "active": True, "used": True, "conf": 0.8, "energy": energy, **more}


def test_nobody_in_front_of_the_eyes_calms_the_dream_and_someone_coming_wakes_it():
    p, quiet, lively = movement.Presence(), [eyes_src(0.0), eyes_src(0.02)], [eyes_src(0.0), eyes_src(0.4)]
    assert p.step(lively, 0.0) is None and not p.calm                            # someone is there: nothing to say
    assert p.step(quiet, 1.0) is None and p.step(quiet, 1.0 + movement.EMPTY - 0.1) is None   # a moment of rest is not "nobody"
    assert p.step(lively, 8.0) is None and p.step(quiet, 9.0) is None            # … and it counts anew after a move
    assert p.step(quiet, 9.0 + movement.EMPTY) == "calm" and p.calm
    assert p.step(quiet, 60.0) is None                                           # said once
    assert p.step(lively, 61.0) == "wake" and not p.calm                         # one pair of eyes with someone is enough
    assert p.step(lively, 62.0) is None


def test_only_dreamy_eyes_the_mode_listens_to_say_who_is_there():
    still = {"active": True, "used": True, "conf": 0.9, "energy": 0.0}
    for other in ([], [{**still, "kind": "camera"}], [{**still, "kind": "phone"}, {**still, "kind": "band"}],
                  [eyes_src(0.0, used=False)], [eyes_src(0.0, active=False)], [eyes_src(0.0, conf=0.0)]):
        p = movement.Presence()
        assert p.step(other, 0.0) is None and p.step(other, 1000.0) is None and not p.calm, other
    # the calm of the eyes ends quietly – no impulse – when they go or the mode stops listening to them
    p = movement.Presence()
    p.step([eyes_src(0.0)], 0.0)
    assert p.step([eyes_src(0.0)], movement.EMPTY) == "calm"
    assert p.step([{**still, "kind": "camera", "energy": 1.0}], movement.EMPTY + 1) == "rest" and not p.calm
    assert p.step([eyes_src(0.0)], movement.EMPTY + 2) is None                   # back: the wait starts anew
    assert p.step([eyes_src(0.0)], 2 * movement.EMPTY + 2) == "calm"
    assert p.step([eyes_src(0.0, used=False)], 2 * movement.EMPTY + 3) == "rest"


def test_the_stage_is_told_when_the_eyes_are_alone(server, register, monkeypatch):
    monkeypatch.setattr(server.movement, "presence", movement.Presence())
    monkeypatch.setattr(server.inputs, "sources_told", {"msg": None})
    monkeypatch.setattr(server.inputs.sens, "by", {})
    monkeypatch.setitem(server.hub.state, "move_off", "")
    monkeypatch.setattr(server.movement, "EMPTY", 0.05)
    sent = []

    async def broadcast(msg, exclude=None, only=None):
        sent.append(msg)
    monkeypatch.setattr(server.hub, "broadcast", broadcast)

    def tell(mode, energy, wait=0.0):
        time.sleep(wait)
        monkeypatch.setitem(server.hub.state, "move_mode", mode)
        register.report("eyes:1", "eyes", "Dreamy Eyes 1", energy, 0.8)
        asyncio.run(server.inputs.sources_tell())
        return [m["cmd"] for m in sent if "cmd" in m]

    assert tell("mood", 0.0) == [] and tell("mood", 0.0, 0.08) == ["calm"]
    assert tell("mood", 0.5) == ["calm", "wake"]
    assert tell("mood", 0.0) == ["calm", "wake"] and tell("mood", 0.0, 0.08) == ["calm", "wake", "calm"]
    assert tell("dance", 0.0)[3:] == ["rest"]                                     # the dance does not listen to the eyes
    assert tell("dance", 0.0, 0.08)[3:] == ["rest"]                              # … however long they are alone
    assert tell("flowtrack", 0.9)[3:] == ["rest"] and tell("off", 0.0, 0.08)[3:] == ["rest"]


def test_a_stage_that_comes_while_the_eyes_are_alone_is_calm_too(server, monkeypatch, saved_state):
    for calm in (False, True):
        p = movement.Presence()
        p.calm = calm
        monkeypatch.setattr(server.movement, "presence", p)
        with client(server, "local").websocket_connect(ws_url(server, "/ctl", "local") + "?role=stage") as ws:
            got = []
            while not got or "state" not in got[-1]:
                got.append(ws.receive_json())
        assert [m["cmd"] for m in got if "cmd" in m] == (["calm"] if calm else [])


# ---------- settings of earlier versions ----------
@pytest.mark.parametrize("old,mode,kind", [
    ({"flowtrack": "off", "flow_kind": "marker"}, "off", "marker"),              # the switch was off: movement is off
    ({"flowtrack": "hand"}, "dance", "hand"),                                    # hands, dance on (it was the default)
    ({"flowtrack": "hand", "dance": True}, "dance", "hand"),
    ({"flowtrack": "marker", "dance": False}, "flowtrack", "marker"),            # the dance was switched off
    ({"flowtrack": "on", "dance": True, "flow_kind": "hand"}, "flowtrack", "on"),   # fire and LEDs: flowtrack
    ({"flowtrack": "maybe"}, "off", "hand"), ({"flowtrack": ["hand"]}, "off", "hand"), ({}, "off", "hand"),
])
def test_the_old_movement_switch_becomes_the_mode(old, mode, kind):
    got = settings.loaded({**old, "motion_sens": 1.7, "touch_amt": 0.4, "touch_paint": False})
    assert (got["move_mode"], got["flow_kind"]) == (mode, kind)
    assert (got["motion_sens"], got["touch_amt"]) == (1.7, 0.4)                  # what stays a setting stays as it was
    assert set(got) == set(settings.DEFAULT_STATE)                               # the old keys are gone
    assert got["dance_kind"] == (kind if mode == "dance" else "hand")            # the dance keeps what it detected with


def test_the_dance_has_its_own_detection():
    """A mode is a preset: light chosen for flowtrack is not what Dream Dance detects with."""
    assert settings.DEFAULT_STATE["dance_kind"] == "hand"
    assert settings.SETTINGS["dance_kind"].choices == ("hand", "marker")
    with pytest.raises(ValueError):
        settings.coerce("dance_kind", "on")                                      # never light: a window would be a hand
    got = settings.loaded({"move_mode": "dance", "flow_kind": "on"})
    assert (got["flow_kind"], got["dance_kind"]) == ("on", "hand")
    assert "dance_kind" not in settings.GUEST_KEYS


def test_a_state_of_today_is_left_alone():
    got = settings.loaded({"move_mode": "mood", "flowtrack": "hand", "flow_kind": "on"})
    assert (got["move_mode"], got["flow_kind"]) == ("mood", "on")
    assert settings.moved({"move_mode": "off", "flowtrack": "on"}) == {"move_mode": "off", "flowtrack": "on"}


def test_the_old_settings_are_no_settings_any_more():
    gone = {"flowtrack", "dance", "motion", "motion_ai", "touch_paint", "touch_warp", "touch_content", "touch_impulse", "touch_light"}
    assert not gone & set(settings.SETTINGS)
    assert set(dance.OLD_SWITCHES) <= gone and {"paint", "warp", "content", "impulse", "light"} == set(dance.OLD_SWITCHES.values())


# ---------- #252: flowtrack – the automatic's switch, the wristband as a source of its own features ----------
def test_flowtracks_automatic_is_on_by_default_and_never_a_guests():
    assert settings.DEFAULT_STATE["flow_auto"] is True and "flow_auto" not in settings.GUEST_KEYS


def test_the_wristband_moves_the_picture_without_gestures():
    """Energy, rotation and the pull on a swung arm act on the picture's tempo, the turning of the effects and the
    colours – rows of the flowtrack preset that rest while no sensor sends, beside the targets of the hands."""
    band = {r["id"]: r for r in dance.BAND_ROWS}
    assert {(r["src"], r["dst"]) for r in band.values()} == {("energy", "fx.speed"), ("spin", "fx.spin"), ("force", "fx.hue")}
    assert band["armspin"]["in"] == [-1.0, 1.0] and band["armspin"]["out"][0] < 0 < band["armspin"]["out"][1]   # it turns both ways
    flow = dance.default_tables()["flowtrack"]
    assert [r["id"] for r in flow] == [r["id"] for r in dance.TOUCH_ROWS + dance.BAND_ROWS]
    assert not any(r["src"].startswith("g.") for r in flow), "no gesture triggers"
    assert dance.clean_rows(flow) == flow
    assert not any(r["id"] in band for r in dance.default_tables()["dance"])       # the dance has its own table


def test_the_sensor_hands_on_the_pull_on_the_arm():
    s = sensors.Sensors()
    s.on_osc("/band/gyro", [1.0, 2.0, 3.0], "192.0.2.7", now=100.0)
    assert s.motion(now=100.01) == {"g": [1.0, 2.0, 3.0], "age": 0.01}           # no acceleration reported: no pull claimed
    for i in range(30):
        s.on_osc("/band/linear_acceleration", [0.0, 12.0, 0.0], "192.0.2.7", now=100.0 + i * 0.01)
        s.on_osc("/band/gyro", [1.0, 2.0, 3.0], "192.0.2.7", now=100.0 + i * 0.01)
    m = s.motion(now=100.3)
    assert m["a"] == pytest.approx(12.0, abs=0.1) and m["g"] == [1.0, 2.0, 3.0]
    s.on_osc("/band/gyro", [1.0, 2.0, 3.0], "192.0.2.7", now=101.0)               # the acceleration stopped coming: no pull claimed
    assert s.motion(now=101.01) == {"g": [1.0, 2.0, 3.0], "age": 0.01}
    raw = sensors.Sensors()                                                       # a raw accelerometer: gravity is taken away
    for i in range(30):
        raw.on_osc("/x/accelerometer", [0.0, 9.81, 0.0], "192.0.2.8", now=200.0 + i * 0.01)
        raw.on_osc("/x/gyro", [0.0, 0.0, 0.1], "192.0.2.8", now=200.0 + i * 0.01)
    assert raw.motion(now=200.3)["a"] == pytest.approx(0.0, abs=0.05)


def test_relieving_and_the_autopilot_never_change_what_the_movement_detects():
    """"Relieve" (the button, Dream Control, the autopilot when Dream is overloaded) takes back what costs most – never
    the movement's mode or detection: "Hands (AI)" turned into "Fire/LED" took a dance its hands."""
    import os
    page = open(os.path.join(os.path.dirname(__file__), "..", "static", "index.html"), encoding="utf-8").read()
    steps = page[page.index("const REL_STEPS = ["):page.index("const REL_NAMES")]
    movement = ("flow_kind", "dance_kind", "move_mode", "move_cam", "move_off", "flow_markers", "marker_l", "marker_r")
    for key in movement:
        assert key not in steps, key
    assert "relSet('flow_kind'" not in page and "relSet('dance_kind'" not in page


# ---------- #237: a phone glows as a light marker while it lends its motion ----------
def test_a_phone_glows_in_a_marker_colour_never_in_a_fire_colour():
    g = movement.Glows()
    for odd in ("red", "orange", "yellow", "white", "", None, 3, ["cyan"]):
        assert g.wish(state(), "Dream Control", odd) is None
    assert not g.by
    assert set(settings.MARKERS) == {"cyan", "green", "blue", "magenta"}
    page = open(os.path.join(os.path.dirname(__file__), "..", "static", "remote.html")).read()
    offered = page.split('id="glowcols"')[1].split("</div>")[0]
    assert sorted(v.split('"')[0] for v in offered.split('data-c="')[1:]) == sorted(settings.MARKERS)   # the page offers exactly these


def test_two_phones_are_two_colours_are_two_hands():
    g, st = movement.Glows(), state(marker_l="cyan", marker_r="magenta")
    assert g.wish(st, "Dream Control", "cyan") == "cyan" and g.hand(st, "Dream Control") == "l"
    assert g.wish(st, "Dream Control 2", "cyan") == "magenta"                    # taken: the free hand's marker colour
    assert g.hand(st, "Dream Control 2") == "r" and g.free_hand(st, "Dream Control 2") == "r"
    assert g.wish(st, "Dream Control 2", "green") == "green" and g.hand(st, "Dream Control 2") is None   # no hand's colour yet
    assert g.free_hand(st, "Dream Control 2") == "r"                             # … the hand the other phone does not hold
    assert g.wish(st, "Dream Control", "green") == "magenta"                     # never two phones in one colour
    assert len(set(g.by.values())) == 2
    assert g.drop("Dream Control 2") and not g.drop("Dream Control 2") and g.by == {"Dream Control": "magenta"}


def test_markers_are_followed_only_while_the_camera_looks_for_them():
    assert movement.markers_followed(state(move_mode="dance", dance_kind="marker"))
    assert movement.markers_followed(state(move_mode="flowtrack", flow_kind="marker"))
    assert movement.markers_followed(state(move_mode="flowtrack", flow_kind="hand", flow_markers=True))
    assert not movement.markers_followed(state(move_mode="flowtrack", flow_kind="hand", flow_markers=False))
    assert not movement.markers_followed(state(move_mode="flowtrack", flow_kind="on", flow_markers=True))
    assert not movement.markers_followed(state(move_mode="dance", dance_kind="hand", flow_kind="marker"))   # the mode's own kind
    assert not movement.markers_followed(state(move_mode="off", flow_kind="marker"))
    assert not movement.markers_followed(state(move_mode="mood", flow_kind="marker"))                       # no camera asked for
    assert not movement.markers_followed(state(move_mode="dance", dance_kind="marker", move_off="camera"))


def test_two_senders_are_never_mixed_into_one_arm():
    s = sensors.Sensors()
    for i in range(10):                                                          # both send, turn about
        s.on_osc("/device/gyroscope", [2.0, 0.0, 0.0], "Dream Control", now=100 + i * 0.03)
        s.on_osc("/device2/gyroscope", [0.0, 0.0, -6.0], "Dream Control 2", now=100.01 + i * 0.03)
    assert s.motion(now=100.3)["g"] == [2.0, 0.0, 0.0]                           # the one that led keeps leading
    assert s.arm("Dream Control", now=100.3)["g"] == [2.0, 0.0, 0.0] and s.arm("Dream Control 2", now=100.3)["g"] == [0.0, 0.0, -6.0]
    assert s.arm("192.0.2.7", now=100.3) is None
    for i in range(20):                                                          # the first falls silent: the second leads
        s.on_osc("/device2/gyroscope", [0.0, 0.0, -6.0], "Dream Control 2", now=100.7 + i * 0.03)
    assert s.motion(now=101.3)["g"] == [0.0, 0.0, -6.0] and s.arm("Dream Control", now=101.3) is None
    # a browser's degrees a second become rad/s for the movement; the channel stays as it came
    s.on_osc("/device2/gyroscope", [0.0, 0.0, 180.0], "Dream Control 2", now=101.31, gyro_unit=3.14159 / 180)
    assert s.arm("Dream Control 2", now=101.32)["g"] == pytest.approx([0.0, 0.0, 3.142], abs=1e-3)
    assert s.ch["/device2/gyroscope:2"].v > 10
    s.forget("Dream Control 2")
    assert "Dream Control 2" not in s.by and s.arm("Dream Control 2", now=101.32) is None


def test_the_stage_gets_each_glowing_phones_motion_by_its_hand(server, monkeypatch, saved_state):
    sens, glows, sent = sensors.Sensors(), movement.Glows(), []
    monkeypatch.setattr(server.inputs, "sens", sens)
    monkeypatch.setattr(server.movement, "glows", glows)

    async def broadcast(msg, exclude=None, only=None):
        sent.append((msg, only))
    monkeypatch.setattr(server.hub, "broadcast", broadcast)
    monkeypatch.setattr(server.inputs.time, "time", lambda: 50.0)
    monkeypatch.setattr(sensors.time, "time", lambda: 50.0)
    server.hub.state.update(move_mode="dance", move_off="", marker_l="cyan", marker_r="magenta")
    sens.on_osc("/device/gyroscope", [1.0, 0.0, 0.0], "Dream Control", now=49.98)
    sens.on_osc("/device2/gyroscope", [0.0, 2.0, 0.0], "Dream Control 2", now=49.99)
    asyncio.run(server.inputs.sensor_dance())
    assert "arms" not in sent[-1][0]["sensors"]["dance"]                         # nobody glows: the sensor as ever
    assert sent[-1][0]["sensors"]["dance"]["r"] == [[0.02, 2, 1.0, 0.0, 0.0]]     # #196: the leading phone's raw values
    glows.wish(server.hub.state, "Dream Control 2", "cyan")
    asyncio.run(server.inputs.sensor_dance())
    assert sent[-1] == ({"sensors": {"dance": {"g": [1.0, 0.0, 0.0], "age": 0.02, "r": [], "arms": {"l": {"g": [0.0, 2.0, 0.0], "age": 0.01}}}}}, "stage")
    glows.wish(server.hub.state, "Dream Control", "magenta")
    asyncio.run(server.inputs.sensor_dance())
    assert set(sent[-1][0]["sensors"]["dance"]["arms"]) == {"l", "r"}
    server.hub.state["marker_l"] = "blue"                                        # the hand's colour changed: that phone is no hand now
    asyncio.run(server.inputs.sensor_dance())
    assert set(sent[-1][0]["sensors"]["dance"]["arms"]) == {"r"}
    server.hub.state["move_off"] = "phone"                                       # phones switched off as a source: nothing of them
    sens.source = "192.0.2.7"
    asyncio.run(server.inputs.sensor_dance())
    assert "arms" not in sent[-1][0]["sensors"]["dance"]
