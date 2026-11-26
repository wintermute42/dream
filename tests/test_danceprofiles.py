"""#266: a dancer's own measures – what a profile may say (numbers only, the standard where a measure says nothing
usable), the file (a broken one: the standard measures act), choosing a profile (the setting, the page, a scene),
keeping and deleting it, and who may do so."""
import asyncio
import json
import os
import re

import pytest

import dance
import danceprofiles
import settings
from test_rights import client, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401  (the roles' devices; nothing left behind)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIM = {"energy": [0.25, 0.5], "open": [0.1, 0.9], "turn": [0.02, 0.5], "height": [0.1, 1.0]}


@pytest.fixture
def profiles(monkeypatch):
    """The profiles Dream holds come back afterwards (the file is the sandbox's: conftest)."""
    monkeypatch.setattr(danceprofiles, "profiles", {})
    monkeypatch.setattr(danceprofiles, "use", "")
    yield danceprofiles


def test_the_standard_measures_are_the_ranges_the_sentences_read():
    for k, (lo, hi, *_rest) in dance.BASE_SHAPE.items():
        assert danceprofiles.STANDARD[k] == ([0.0, 1.0] if k == "turn" else [lo, hi]), k   # turning: by how far
    assert list(danceprofiles.STANDARD) == list(dance.BASE_SOURCES)
    js = open(os.path.join(ROOT, "static", "dancecal.js"), encoding="utf-8").read()
    (fallback,) = re.findall(r"\|\| \{ energy: \[([^}]*)\] \}", js)          # what the page shows before Dream told it
    assert fallback == "0.1, 0.8], open: [0.45, 0.95], turn: [0, 1], height: [0.55, 1"
    test = open(os.path.join(ROOT, "tests", "js", "dancecal.test.mjs"), encoding="utf-8").read()
    assert "const STD = { energy: [0.1, 0.8], open: [0.45, 0.95], turn: [0, 1], height: [0.55, 1] };" in test


def test_what_a_measure_may_say():
    clean = danceprofiles.clean_bounds
    assert clean(KIM) == KIM
    assert clean(None) is None and clean([]) is None and clean({}) is None
    assert clean({"energy": [0.4, 0.42]}) is None                               # too narrow to act: nothing of its own
    got = clean({"energy": [0.2, 0.6], "open": [0.5, 2], "turn": ["a", 1], "height": [True, 0.9], "elbow": [0, 1]})
    assert got == {"energy": [0.2, 0.6], **{k: danceprofiles.STANDARD[k] for k in ("open", "turn", "height")}}   # the rest: standard
    assert clean({"energy": [0.6, 0.2]}) is None and clean({"energy": [float("nan"), 1]}) is None
    assert danceprofiles.clean_name("Kim") == "Kim" and danceprofiles.clean_name("../x") is None and danceprofiles.clean_name("") is None


def test_keeping_choosing_and_deleting_a_profile(profiles):
    assert profiles.bounds_now() is None and not os.path.exists(profiles.FILE)   # the standard measures: no file
    assert profiles.save("Kim", KIM) and profiles.use == "Kim" and profiles.bounds_now() == KIM
    assert profiles.save("Alex", {"energy": [0.05, 0.3]}) and profiles.use == "Alex"
    assert profiles.choose("Kim") and profiles.use == "Kim"
    assert not profiles.choose("nobody") and profiles.use == "Kim"              # a name that is no profile changes nothing
    with open(profiles.FILE) as f:
        kept = json.load(f)
    assert kept == {"version": 1, "use": "Kim", "profiles": {"Kim": {"bounds": KIM}, "Alex": {"bounds": profiles.profiles["Alex"]["bounds"]}}}
    assert re.fullmatch(r'[\s\w{}\[\]":,.-]*', json.dumps(kept))               # names and numbers – nothing else
    profiles.reload()
    assert profiles.use == "Kim" and profiles.bounds_now() == KIM                # it comes back after a start
    assert profiles.save("Kim", {**KIM, "energy": [0.3, 0.6]}) and profiles.bounds_now()["energy"] == [0.3, 0.6]   # measured anew
    assert profiles.delete("Kim") and profiles.use == "" and profiles.bounds_now() is None   # back to the standard measures
    assert not profiles.save("../x", KIM) and not profiles.save("Kim", {}) and not profiles.delete("Kim")
    assert profiles.delete("Alex") and not os.path.exists(profiles.FILE)


@pytest.mark.parametrize("content", ["{broken", "[]", '{"version": 9, "profiles": {}}', '{"version": 1, "profiles": []}',
                                     '{"version": 1, "use": "Kim", "profiles": {"Kim": {"bounds": "x"}}}'])
def test_a_broken_or_unknown_file_leaves_the_standard_measures(profiles, content):
    os.makedirs(os.path.dirname(profiles.FILE), exist_ok=True)
    with open(profiles.FILE, "w") as f:
        f.write(content)
    profiles.reload()
    assert profiles.profiles == {} and profiles.use == "" and profiles.bounds_now() is None


def test_a_profile_with_a_bad_name_or_a_use_that_is_none_is_left_out(profiles):
    os.makedirs(os.path.dirname(profiles.FILE), exist_ok=True)
    with open(profiles.FILE, "w") as f:
        json.dump({"version": 1, "use": "../x", "profiles": {"../x": {"bounds": KIM}, "Kim": {"bounds": KIM}}}, f)
    profiles.reload()
    assert list(profiles.profiles) == ["Kim"] and profiles.use == ""


def test_the_setting_is_never_a_guests_and_a_scene_may_carry_it():
    assert settings.DEFAULT_STATE["dance_profile"] == "" and "dance_profile" not in settings.GUEST_KEYS
    assert settings.coerce("dance_profile", "Kim") == "Kim" and settings.coerce("dance_profile", "../x") == ""


def test_the_setting_chooses_the_profile(server, profiles, saved_state):
    assert profiles.save("Kim", KIM)
    asyncio.run(server.hub.apply({"dance_profile": ""}))
    assert profiles.use == "" and server.hub.state["dance_profile"] == ""
    asyncio.run(server.hub.apply({"dance_profile": "Kim"}))
    assert profiles.use == "Kim"
    asyncio.run(server.hub.apply({"dance_profile": "nobody"}))                   # no such profile: the one in use stays
    assert profiles.use == "Kim" and server.hub.state["dance_profile"] == "Kim"


def _talk(server, role, *msgs):
    with client(server, role).websocket_connect(ws_url(server, "/ctl", role)) as ws:
        assert ws.receive_json()["role"] == role
        for m in msgs:
            ws.send_text(json.dumps(m))
        ws.send_text(json.dumps({"set": {"prompt": "after the profiles"}}))
        if role != "eyes":
            wait_until(lambda: server.hub.state["prompt"] == "after the profiles")
        else:
            ws.send_text(json.dumps({"feed": {"cam": False}}))


@pytest.mark.parametrize("role,may", [("local", True), ("control", True), ("guest", False), ("eyes", False)])
def test_only_control_and_this_mac_keep_measures(server, profiles, saved_state, role, may):
    _talk(server, role, {"dance_profiles": {"op": "save", "name": "Kim", "bounds": KIM}}, {"set": {"dance_profile": ""}})
    if may:
        assert profiles.profiles == {"Kim": {"bounds": KIM}} and profiles.use == "" and server.hub.state["dance_profile"] == ""
        _talk(server, role, {"dance_profiles": {"op": "save", "name": "Kim", "bounds": KIM}})
        assert profiles.use == "Kim" and server.hub.state["dance_profile"] == "Kim"   # kept: in use, and the setting says so
        _talk(server, role, {"dance_profiles": {"op": "delete", "name": "Kim"}})
        assert profiles.profiles == {} and server.hub.state["dance_profile"] == ""
    else:
        assert profiles.profiles == {} and profiles.use == ""


def test_every_control_device_is_told_the_measures(server, profiles):
    assert profiles.save("Kim", KIM)
    with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ws:
        got = [ws.receive_json() for _ in range(7)]
    (told,) = [m["dance"]["profiles"] for m in got if "profiles" in m.get("dance", {})]
    assert told == {"use": "Kim", "names": ["Kim"], "data": {"Kim": KIM}, "std": danceprofiles.STANDARD, "min": danceprofiles.MIN_SPAN}
    assert any("slots" in m.get("dance", {}) for m in got)                      # in the one message of the dance


# ---------- #266: the names of sets and dancers only for this Mac and Dream Control ----------
@pytest.mark.parametrize("role", ["guest", "eyes", "window", None, "stranger"])
def test_a_role_without_names_hears_none(role):
    import rights
    msg = {"set": {"dance_set": "Glow Set", "dance_profile": "Kim", "prompt": "a lake"}, "state": {"dance_set": "Glow Set", "master": 1.0},
           "dance": {"slots": {"sets": ["Glow Set"]}, "profiles": {"names": ["Kim"]}, "faders": [{"id": "f0a1b2c3d", "name": "Kims Knees"}], "map": []}}
    got = rights.scrub(role, msg)
    assert "Glow" not in json.dumps(got) and "Kim" not in json.dumps(got)
    assert got == {"set": {"prompt": "a lake"}, "state": {"master": 1.0}, "dance": {"map": []}}   # the rest is told as before
    assert rights.scrub(role, {"set": {"dance_set": "Glow Set"}}) is None                 # nothing left: nothing is sent
    assert rights.scrub(role, {"dance": {"profiles": {}}}) is None
    assert rights.scrub(role, {"dance": {"faders": []}}) is None                          # #267: the base movements a dancer named
    for may in ("local", "control"):
        assert rights.scrub(may, msg) is msg


def test_no_guest_and_no_output_ever_hears_a_set_or_a_dancer(server, profiles, saved_state, monkeypatch):
    """A guest's phone, its output window, Dreamy Eyes and a dream window: none of them ever receives the name of a set or
    of a measured dancer – not in the greeting, not in a change, not in the dance's message. This Mac and Dream Control do."""
    monkeypatch.setattr(dance, "tables", dance.default_tables())                 # the sets and tables come back afterwards
    monkeypatch.setattr(dance, "slot_sets", {})
    monkeypatch.setattr(dance, "slot_use", "standard")
    monkeypatch.setattr(dance, "slot_drafts", {})
    assert profiles.save("Kim", KIM) and dance.save_slots_as("Glow Set", dance.SLOT_SETS["waves"], "waves")
    server.hub.state.update(dance_set="Glow Set", dance_profile="Kim")
    told, post = [], server.hub.outbox.post
    monkeypatch.setattr(server.hub.outbox, "post", lambda sock, data: (
        told.append((server.hub.roles.get(sock) or server.hub.key_roles.get(sock), data)) if isinstance(data, str) else None, post(sock, data))[1])
    k, view = server.rights.keys, "ws://192.168.1.20:7860/view"
    with client(server, "guest").websocket_connect(ws_url(server, "/ctl", "guest")), \
            client(server, "eyes").websocket_connect(ws_url(server, "/ctl", "eyes") + "&as=eyes"), \
            client(server, "guest").websocket_connect(f"{view}?k={k['guest']}"), \
            client(server, "eyes").websocket_connect(f"{view}?preview=1&as=eyes&k={k['eyes']}"), \
            client(server, "window").websocket_connect(f"{view}?as=window&k={k['window']}"), \
            client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ctl:
        wait_until(lambda: len(server.hub.viewers) == 2)
        for m in ({"dance_profiles": {"op": "save", "name": "Kim", "bounds": KIM}}, {"set": {"dance_profile": ""}},
                  {"set": {"dance_profile": "Kim"}}, {"set": {"dance_set": "standard"}}, {"set": {"dance_set": "Glow Set"}},
                  {"dance_slots": {"op": "draft", "name": "Glow Set", "slots": dance.SLOT_SETS["fire"]}},
                  {"set": {"prompt": "after the names"}}):
            ctl.send_text(json.dumps(m))
        wait_until(lambda: server.hub.state["prompt"] == "after the names")
        wait_until(lambda: sum(1 for r, t in told if r == "guest" and "after the names" in t) >= 1)
    without = [t for r, t in told if not server.rights.can(r, "names")]
    assert {r for r, _ in told} >= {"guest", "control", "window"} and without
    assert not [t for t in without if "Kim" in t or "Glow" in t]
    mine = [t for r, t in told if r == "control"]
    assert any("Kim" in t for t in mine) and any("Glow Set" in t for t in mine)          # Dream Control hears them
