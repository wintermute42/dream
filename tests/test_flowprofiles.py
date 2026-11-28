"""Flowtrack's performers (#253, flowprofiles.py): what may be kept of a person's profile (numbers, the chosen name and
a few fixed words – never a picture), where it is kept and exported to, who may list, add, rename, export and delete,
what the stage hears of it, and that a deleted profile is no longer the one in use. Every profile here is invented."""
import asyncio
import json
import os
import subprocess
import sys

import pytest

from test_dancelab import PICTURE
from test_dancemoves import TPL
from test_rights import client, key_of, no_ghost_sockets, saved_state  # noqa: F401  (the roles' devices; nothing left behind)

STATS = {"seconds": 56.9, "total": 60.0, "speed": {"lo": 3.1, "mid": 3.8, "hi": 9.2}, "energy": {"hi": 1}, "turn": {"hi": 1.65, "dir": 0.99, "share": 0.83},
         "open": {"lo": 0.17, "hi": 0.91}, "height": None, "tempo": {"lo": 49.6, "mid": 107.0, "hi": 108.3, "share": 0.6},
         "planes": {"wall": 1, "wheel": 0, "floor": 0}, "round": 0.83, "pair": {"rigid": 0.54, "share": 1}, "arm": None,
         "curve": [round((i % 8) / 8, 3) for i in range(24)], "view": {"reach": 0.1, "gap": 0, "kind": "on"}}


def profile(**more):
    return {"format": "dream-flow-profile", "version": 1, "name": "Anna – Poi", "prop": "poi", "stats": json.loads(json.dumps(STATS)),
            "figures": [{"tpl": json.loads(json.dumps(TPL)), "share": 0.4}], **more}


@pytest.fixture
def store(server, monkeypatch, tmp_path):
    """The part itself, keeping its profiles (and the exports) in this test's own folder."""
    monkeypatch.setattr(server.flowprofiles, "DIR", str(tmp_path / "state" / "dance" / "profiles"))
    monkeypatch.setattr(server.dancelab, "DIR", str(tmp_path / "state" / "dance"))
    return server.flowprofiles


def test_profiles_live_in_the_state_folder_beside_the_sessions_never_in_the_repository(server):
    p = server.flowprofiles
    assert p.DIR == os.path.join(server.dancelab.DIR, "profiles") and p.DIR.startswith(server.hub.STATE_DIR + os.sep)
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assert not p.DIR.startswith(here)
    with open(os.path.join(here, "static", "flowprofile.js")) as f:
        js = f.read()
    assert "MAX_FIGURES = 3, BINS = 24" in js and f"FORMAT = '{p.FORMAT}', VERSION = {p.VERSION}" in js     # the two sides agree
    assert all(f"{prop}:" in js for prop in p.PROPS)
    # a person's name: the rule of a movement set's name, on both sides
    assert p.NAME is server.settings.SET_NAME and r"const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_ .+\-–]{0,31}$/u;" in js
    # no profile, session or export of a person is part of the repository
    tracked = subprocess.run(["git", "ls-files"], cwd=here, capture_output=True, text=True).stdout.split("\n")
    assert not [n for n in tracked if "flow-profile-" in n or n.startswith("profiles/")]


def test_a_profile_is_kept_as_numbers_the_name_and_fixed_words(store):
    p = store.clean(profile())
    assert p == profile()
    assert store.clean(profile(name="  Ben   - Stab ", prop="staff"))["name"] == "Ben - Stab"
    assert store.clean(profile(figures=[]))["figures"] == []
    assert store.clean(profile(extra="dropped", jpeg=PICTURE)) == profile()            # only what a profile has is kept


@pytest.mark.parametrize("spoil", [
    lambda p: p.update(format="dream-dance"), lambda p: p.update(version=2), lambda p: p.update(name=""), lambda p: p.update(name="x" * 33),
    lambda p: p.update(name="<b>Anna</b>"), lambda p: p.update(name=7), lambda p: p.update(name="a\nb\x00"), lambda p: p.update(name="../../x"),
    lambda p: p.update(prop="sword"), lambda p: p.update(prop=None), lambda p: p.update(stats=None), lambda p: p.update(figures="none"),
    lambda p: p.update(figures=[p["figures"][0]] * 4), lambda p: p["figures"][0].update(tpl=None), lambda p: p["figures"][0].update(share=2),
    lambda p: p["figures"][0]["tpl"].update(hands="both"), lambda p: p["figures"][0].update(frames=[]),
    lambda p: p["stats"].pop("speed"), lambda p: p["stats"]["speed"].update(hi="fast"), lambda p: p["stats"]["speed"].update(hi=float("inf")),
    lambda p: p["stats"]["speed"].update(hi=True), lambda p: p["stats"]["speed"].update(more=1), lambda p: p["stats"]["turn"].update(dir=-2),
    lambda p: p["stats"]["tempo"].update(mid=5), lambda p: p["stats"].update(open={"lo": 0, "hi": 3}), lambda p: p["stats"].update(curve=[0.5] * 23),
    lambda p: p["stats"]["view"].update(kind="laser"), lambda p: p["stats"]["view"].update(reach=-1), lambda p: p["stats"].update(seconds=None),
    # a picture has no way in
    lambda p: p["stats"].update(jpeg=PICTURE), lambda p: p["stats"]["curve"].__setitem__(3, PICTURE), lambda p: p["stats"]["view"].update(kind=PICTURE),
    lambda p: p["stats"]["speed"].update(hi=PICTURE), lambda p: p.update(name=PICTURE), lambda p: p.update(prop=PICTURE),
    lambda p: p["figures"][0]["tpl"]["pts"].__setitem__(4, [0, 0, 0, PICTURE]),
])
def test_what_is_not_a_profile_is_not_kept(store, spoil):
    p = profile()
    spoil(p)
    assert store.clean(p) is None


@pytest.mark.parametrize("odd", [None, [], "profile", 7, {"format": "dream-flow-profile"}])
def test_anything_else_is_no_profile(store, odd):
    assert store.clean(odd) is None


def test_the_routes_keep_list_rename_export_and_delete_a_profile(server, store):
    c = client(server, "local")
    assert c.get("/flow/profiles").json()["profiles"] == []
    r = c.post("/flow/profiles", content=json.dumps(profile()))
    assert r.status_code == 200 and store.ID.fullmatch(r.json()["id"])
    pid = r.json()["id"]
    listed = c.get("/flow/profiles").json()
    assert listed["profiles"] == [{"id": pid, "at": r.json()["at"], **profile()}]
    assert listed["folder"].endswith(os.path.join("dance", "profiles"))
    assert os.listdir(store.DIR) == [f"{pid}.json"] and oct(os.stat(os.path.join(store.DIR, f"{pid}.json")).st_mode & 0o777) == "0o600"
    r = c.post(f"/flow/profiles/{pid}", content=json.dumps({"name": "Ben – Stab", "prop": "staff"}))
    assert r.status_code == 200 and (r.json()["name"], r.json()["prop"], r.json()["stats"]) == ("Ben – Stab", "staff", STATS)
    assert c.post(f"/flow/profiles/{pid}", content=json.dumps({"prop": "fans"})).json()["name"] == "Ben – Stab"
    for bad in ({"name": ""}, {"name": "<i>"}, {"prop": "sword"}, [], "name"):
        assert c.post(f"/flow/profiles/{pid}", content=json.dumps(bad)).status_code == 422
    assert [(p["name"], p["prop"]) for p in c.get("/flow/profiles").json()["profiles"]] == [("Ben – Stab", "fans")]
    # the export: a copy in the exports folder of the state folder, named by the id alone – and it can be taken in again
    out = c.post(f"/flow/profiles/{pid}/export").json()
    exports = os.path.join(server.dancelab.DIR, "exports")
    assert os.listdir(exports) == [f"flow-profile-{pid}.json"] and out["file"].endswith(f"flow-profile-{pid}.json") and "Ben" not in out["file"]
    with open(os.path.join(exports, f"flow-profile-{pid}.json")) as f:
        copy = json.load(f)
    assert copy == profile(name="Ben – Stab", prop="fans")
    again = c.post("/flow/profiles", content=json.dumps(copy))
    assert again.status_code == 200 and again.json()["id"] != pid and len(c.get("/flow/profiles").json()["profiles"]) == 2
    assert c.delete(f"/flow/profiles/{again.json()['id']}").json() == {"ok": True}
    assert c.delete(f"/flow/profiles/{pid}").json() == {"ok": True}
    assert c.delete(f"/flow/profiles/{pid}").status_code == 404 and c.post(f"/flow/profiles/{pid}/export").status_code == 404
    assert c.post(f"/flow/profiles/{pid}", content=json.dumps({"name": "x"})).status_code == 404
    assert c.get("/flow/profiles").json()["profiles"] == [] and os.listdir(store.DIR) == []


@pytest.mark.parametrize("body", [b"", b"{not json", b"[]", b'{"format": "dream-flow-profile"}', b"[" * 70000, b"\xff\xfe\x00",
                                  json.dumps(profile(stats={**STATS, "round": float("nan")})).encode(), json.dumps(profile(blob="x" * 70000)).encode()])
def test_the_route_refuses_what_is_no_profile_and_writes_nothing(server, store, body):
    r = client(server, "local").post("/flow/profiles", content=body)
    assert r.status_code == 422 and "error" in r.json()
    assert not os.path.isdir(store.DIR) or os.listdir(store.DIR) == []


def test_there_is_an_end_to_the_profiles(server, store, monkeypatch):
    c = client(server, "local")
    monkeypatch.setattr(store, "MAX_PROFILES", 2)
    assert [c.post("/flow/profiles", content=json.dumps(profile())).status_code for _ in range(3)] == [200, 200, 409]
    assert len(store.listing()) == 2


@pytest.mark.parametrize("pid", ["p0a1b2c3", "p0a1b2c3d4", "x0a1b2c3d", "p0A1B2C3D", "..%2F..%2Fstate", "p0a1b2c3d.json"])
def test_only_a_profile_id_names_a_profile(server, store, pid):
    store.save(store.clean(profile()))
    c = client(server, "local")
    assert c.delete(f"/flow/profiles/{pid}").status_code == 404 and c.post(f"/flow/profiles/{pid}/export").status_code == 404
    assert c.post(f"/flow/profiles/{pid}", content=json.dumps({"name": "x"})).status_code == 404
    assert len(store.listing()) == 1 and store.export("../" + pid) is None
    with pytest.raises(ValueError):
        store._path("../" + pid)


def test_a_file_changed_by_hand_into_something_else_is_not_listed(server, store):
    good, bad = store.save(store.clean(profile())), store.save(store.clean(profile(name="Two")))
    with open(store._path(bad["id"]), "w") as f:
        json.dump({**profile(name="<img>"), "at": 1}, f)
    assert [p["id"] for p in store.listing()] == [good["id"]]
    with open(store._path(good["id"]), "w") as f:
        f.write("{broken")
    assert store.listing() == []


@pytest.mark.parametrize("role", ["guest", "eyes", "window", "none"])
def test_a_guest_the_eyes_a_window_and_a_stranger_reach_no_profile(server, store, role):
    pid = store.save(store.clean(profile()))["id"]
    c, q = client(server, role), key_of(server, role)
    for method, path in (("GET", "/flow/profiles"), ("POST", "/flow/profiles"), ("POST", f"/flow/profiles/{pid}"),
                         ("POST", f"/flow/profiles/{pid}/export"), ("DELETE", f"/flow/profiles/{pid}")):
        r = c.request(method, path, params=q, content=json.dumps(profile(name="Other")) if method == "POST" else None)
        assert r.status_code in (401, 403), (role, method, path, r.status_code)
        assert "Anna" not in r.text and "stats" not in r.text
    assert [(p["id"], p["name"]) for p in store.listing()] == [(pid, "Anna – Poi")]        # still there, unchanged, nothing added
    assert not os.path.isdir(os.path.join(server.dancelab.DIR, "exports"))


def test_dream_control_reaches_them_as_this_mac_does(server, store):
    pid = store.save(store.clean(profile()))["id"]
    got = client(server, "control").get("/flow/profiles", params=key_of(server, "control"))
    assert got.status_code == 200 and got.json()["profiles"][0]["id"] == pid


def test_the_profile_in_use_is_a_setting_no_guest_may_change_and_a_deleted_one_is_no_longer_in_use(server, store, saved_state):
    settings = server.settings
    assert settings.DEFAULT_STATE["flow_profile"] == "" and "flow_profile" not in settings.GUEST_KEYS
    for v, ok in (("p0a1b2c3d", True), ("", True), ("p0a1b2c3", False), ("../x", False), ("Anna", False)):
        assert settings.coerce("flow_profile", v) == (v if ok else "")
    a, b = store.save(store.clean(profile())), store.save(store.clean(profile(name="Two")))
    asyncio.run(server.hub.apply({"flow_profile": a["id"]}))
    c = client(server, "local")
    assert c.delete(f"/flow/profiles/{b['id']}").status_code == 200 and server.hub.state["flow_profile"] == a["id"]   # another one's going changes nothing
    assert c.delete(f"/flow/profiles/{a['id']}").status_code == 200 and server.hub.state["flow_profile"] == ""


def test_control_and_this_mac_hear_which_profiles_there_are_a_guest_and_the_eyes_do_not(server, store, monkeypatch):
    devices = {"mac": "local", "phone": "control", "visitor": "guest", "eyes": "eyes"}
    monkeypatch.setattr(server.hub, "clients", {d: "remote" for d in devices})
    monkeypatch.setattr(server.hub, "roles", dict(devices))
    told = []
    monkeypatch.setattr(server.hub.outbox, "post", lambda sock, data: told.append((sock, json.loads(data))) or True)
    c = client(server, "local")
    pid = c.post("/flow/profiles", content=json.dumps(profile())).json()["id"]
    assert sorted(d for d, _ in told) == ["mac", "phone"]
    assert [p["id"] for p in told[0][1]["dance"]["performers"]] == [pid]
    told.clear()
    assert c.post(f"/flow/profiles/{pid}", content=json.dumps({"name": "New"})).status_code == 200
    assert [m["dance"]["performers"][0]["name"] for _, m in told] == ["New", "New"]
    told.clear()
    assert c.delete(f"/flow/profiles/{pid}").status_code == 200
    assert [(d, m["dance"]["performers"]) for d, m in told if "dance" in m] == [("mac", []), ("phone", [])]
    assert not any(d in ("visitor", "eyes") and "New" in json.dumps(m) for d, m in told)


def test_the_choice_travels_as_an_id_a_persons_name_never_reaches_a_guest_or_an_output(server, store, monkeypatch, saved_state):
    """The setting is what every control line hears (a guest's phone too): it holds the profile's id, never the name –
    the name only reaches this Mac and Dream Control (the routes above and `_tell`)."""
    devices = {"mac": "local", "phone": "control", "visitor": "guest", "eyes": "eyes"}
    monkeypatch.setattr(server.hub, "clients", {d: "remote" for d in devices})
    monkeypatch.setattr(server.hub, "roles", dict(devices))
    told = []
    monkeypatch.setattr(server.hub.outbox, "post", lambda sock, data: told.append((sock, data)) or True)
    pid = store.save(store.clean(profile()))["id"]
    asyncio.run(server.hub.apply({"flow_profile": pid}))
    heard = {d: " ".join(m for s, m in told if s == d) for d in devices}
    assert pid in heard["visitor"] and "Anna" not in heard["visitor"]
    assert not any("Anna" in m for _, m in told), "the change of the setting carries no name for anyone"
    assert "Anna" not in json.dumps(server.hub.state)


def test_the_module_loads_nothing_heavy():
    out = subprocess.run([sys.executable, "-c", "import sys, flowprofiles; print('torch' in sys.modules)"],
                         cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), capture_output=True, text=True,
                         env={**os.environ, "DREAM_ROLE": "app"})
    assert out.stdout.strip() == "False", out.stderr


@pytest.mark.parametrize("version", [2, 3])
def test_the_rows_of_a_profile_are_part_of_flowtracks_table_and_join_a_table_kept_before_them_once(server, monkeypatch, tmp_path, version):
    dance = server.dance
    monkeypatch.setattr(dance, "MAP_FILE", str(tmp_path / "config" / "dance.json"))
    monkeypatch.setattr(dance, "tables", dance.default_tables())
    monkeypatch.setattr(dance, "slot_sets", {})
    monkeypatch.setattr(dance, "slot_use", "standard")
    built = dance.default_tables()
    rows = {r["id"]: r for r in dance.PROFILE_ROWS}
    assert (rows["figure"]["src"], rows["figure"]["on"], rows["round"]["src"], rows["round"]["on"]) == ("figure", True, "round", False)
    assert built["flowtrack"][-2:] == dance.PROFILE_ROWS and dance.clean_rows(dance.PROFILE_ROWS) == dance.PROFILE_ROWS
    assert not any(r["src"] in ("figure", "round") for m in ("mood", "dance") for r in built[m])
    # a table kept before the profiles (#249's file, or #265's with the sets of sentences): the owner's rows stay, the
    # two new ones join – and the sets of sentences of a file of #265 stay as they are (they are migrated only once)
    old = [r for r in built["flowtrack"] if r["id"] not in rows][:3]
    own = {"Night": {"from": "waves", "slots": dance.builtin_slots()["waves"]}}
    os.makedirs(os.path.dirname(dance.MAP_FILE))
    with open(dance.MAP_FILE, "w") as f:
        json.dump({"version": version, "tables": {"flowtrack": old}, **({"slots": {"use": "Night", "sets": own}} if version == 3 else {})}, f)
    got = dance.load_tables()["flowtrack"]
    assert got[:3] == old and got[3:] == dance.PROFILE_ROWS
    assert dance.load_slots() == ((own, "Night") if version == 3 else ({}, "standard"))
    # … once: kept as the new version, a row the owner deleted then stays deleted
    monkeypatch.setattr(dance, "tables", dance.load_tables())
    dance.set_rows([r for r in got if r["id"] != "round"], "flowtrack")
    with open(dance.MAP_FILE) as f:
        assert json.load(f)["version"] == dance.VERSION == 4
    assert [r["id"] for r in dance.load_tables()["flowtrack"]] == [r["id"] for r in old] + ["figure"]
