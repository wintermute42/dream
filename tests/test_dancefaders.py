"""Base movements of one's own (#267, dancefaders.py): what may be kept of a taught base movement (a small regression
and names – numbers only, never a picture), where it is kept, who may list, add, rename, teach again and delete, what
the stage and Dream Control hear of it, that a broken file is no base movement, and that a deleted one takes its base
sentences along."""
import json
import os

import pytest

from test_dancelab import PICTURE
from test_rights import client, key_of, no_ghost_sockets, saved_state  # noqa: F401  (the roles' devices; nothing left behind)

MODEL = {"v": 1, "keys": ["knee_l.v", "knee_r.v", "ankle_l.v", "ankle_r.v"], "m": [-3.0, -3.0, -4.0, -4.0], "w": [0.3, 0.3, 0.37, 0.37],
         "b": 0.5, "share": [0.2, 0.2, 0.3, 0.3], "states": [{"y": 0, "at": 0.02}, {"y": 1, "at": 0.98}]}


def fader(**more):
    return {"format": "dream-dance-fader", "version": 1, "name": "Knees", "states": [{"name": "upright", "y": 0}, {"name": "deep in the knees", "y": 1}],
            "model": json.loads(json.dumps(MODEL)), **more}


def three():
    f = fader(name="Lean", states=[{"name": "left", "y": 0}, {"name": "middle", "y": 0.5}, {"name": "right", "y": 1}])
    f["model"]["states"] = [{"y": 0, "at": 0}, {"y": 0.5, "at": 0.5}, {"y": 1, "at": 1}]
    return f


@pytest.fixture
def store(server, monkeypatch, tmp_path):
    """The part itself, keeping its faders in this test's own folder, with the built-in tables and sets."""
    monkeypatch.setattr(server.dancefaders, "DIR", str(tmp_path / "state" / "dance" / "faders"))
    monkeypatch.setattr(server.dance, "MAP_FILE", str(tmp_path / "config" / "dance.json"))
    monkeypatch.setattr(server.dance, "tables", server.dance.default_tables())
    for name, value in (("slot_sets", {}), ("slot_use", "standard"), ("slot_drafts", {})):
        monkeypatch.setattr(server.dance, name, value)
    return server.dancefaders


def test_faders_live_in_the_state_folder_beside_the_moves_never_in_the_repository(server):
    f = server.dancefaders
    assert f.DIR == os.path.join(server.dancelab.DIR, "faders") and f.DIR.startswith(server.hub.STATE_DIR + os.sep)
    assert not f.DIR.startswith(os.path.dirname(os.path.abspath(f.__file__)))
    assert len(f.KEYS) == 27 and f.KEYS[:2] == ("head.u", "head.v")             # static/dancefaders.js KEYS (tests/js/dancefaders.test.mjs)


def test_a_fader_is_kept_as_its_names_and_its_regression(store):
    assert store.clean(fader()) == {"name": "Knees", "states": [{"name": "upright", "y": 0.0}, {"name": "deep in the knees", "y": 1.0}], "model": MODEL}
    assert store.clean(three())["states"][1] == {"name": "middle", "y": 0.5}
    assert store.clean(fader(name="  Big   Knees 2 "))["name"] == "Big Knees 2"


@pytest.mark.parametrize("spoil", [
    lambda f: f.update(format="dream-dance-move"), lambda f: f.update(version=2), lambda f: f.update(name=""), lambda f: f.update(name="x" * 33),
    lambda f: f.update(name="<b>"), lambda f: f.update(name=7), lambda f: f.update(name=PICTURE),
    lambda f: f.update(states=[]), lambda f: f.update(states="states"), lambda f: f["states"].pop(), lambda f: f["states"][0].update(name=""),
    lambda f: f["states"][0].update(name=PICTURE), lambda f: f["states"][1].update(y=0.5), lambda f: f["states"].reverse(),
    lambda f: f["states"].__setitem__(0, "upright"), lambda f: f.update(model=None), lambda f: f["model"].update(v=2),
    lambda f: f["model"].update(keys=["knee_l.z", "knee_r.v", "ankle_l.v", "ankle_r.v"]), lambda f: f["model"].update(keys=["knee_l.v"] * 4),
    lambda f: f["model"].update(keys=[]), lambda f: f["model"]["m"].pop(), lambda f: f["model"]["w"].__setitem__(0, float("nan")),
    lambda f: f["model"]["w"].__setitem__(0, 1e9), lambda f: f["model"]["w"].__setitem__(0, True), lambda f: f["model"]["share"].__setitem__(0, 2),
    lambda f: f["model"].update(b="x"), lambda f: f["model"].update(states=[{"y": 0, "at": 0}]), lambda f: f["model"]["states"].__setitem__(0, 0),
    lambda f: f["model"]["states"][0].update(y=-1),
    # a picture has no way in
    lambda f: f["model"]["m"].__setitem__(0, PICTURE), lambda f: f["model"].update(keys=[PICTURE] * 4), lambda f: f["states"][1].update(y=PICTURE),
])
def test_what_is_not_a_fader_is_not_kept(store, spoil):
    f = fader()
    spoil(f)
    assert store.clean(f) is None


def test_the_routes_keep_list_rename_teach_again_and_delete_a_fader(server, store):
    c = client(server, "local")
    assert c.get("/dance/faders").json()["faders"] == []
    r = c.post("/dance/faders", content=json.dumps(fader()))
    assert r.status_code == 200 and store.ID.fullmatch(r.json()["id"])
    fid, at = r.json()["id"], r.json()["at"]
    listed = c.get("/dance/faders").json()
    assert [(f["id"], f["name"], f["model"]) for f in listed["faders"]] == [(fid, "Knees", MODEL)] and "faders" in listed["folder"]
    assert c.post(f"/dance/faders/{fid}", content=json.dumps({"name": "Squat"})).json()["name"] == "Squat"
    # taught again: other states and another regression – the same id (its sentences stay), the same place in the list
    again = c.post(f"/dance/faders/{fid}", content=json.dumps(three()))
    assert again.status_code == 200 and again.json()["id"] == fid and again.json()["at"] == at and again.json()["name"] == "Lean"
    assert [s["name"] for s in c.get("/dance/faders").json()["faders"][0]["states"]] == ["left", "middle", "right"]
    for bad in ({"name": ""}, {"name": "<img>"}, {"model": None}, {**three(), "states": []}, [], "x"):
        assert c.post(f"/dance/faders/{fid}", content=json.dumps(bad)).status_code == 422
    assert c.get("/dance/faders").json()["faders"][0]["name"] == "Lean"
    assert c.delete(f"/dance/faders/{fid}").json() == {"ok": True}
    assert c.delete(f"/dance/faders/{fid}").status_code == 404 and c.post(f"/dance/faders/{fid}", content=json.dumps({"name": "x"})).status_code == 404
    assert c.get("/dance/faders").json()["faders"] == [] and os.listdir(store.DIR) == []


@pytest.mark.parametrize("body", [b"", b"{not json", b"[]", b'{"format": "dream-dance-fader"}', b"[" * 200000, b"\xff\xfe\x00",
                                  json.dumps({**fader(), "model": {**MODEL, "b": float("nan")}}).encode()])
def test_the_route_refuses_what_is_no_fader_and_writes_nothing(server, store, body):
    r = client(server, "local").post("/dance/faders", content=body)
    assert r.status_code == 422 and "error" in r.json()
    assert not os.path.isdir(store.DIR) or os.listdir(store.DIR) == []


def test_there_is_an_end_to_the_faders_and_to_their_size(server, store, monkeypatch):
    c = client(server, "local")
    monkeypatch.setattr(store, "MAX_FADERS", 2)
    assert [c.post("/dance/faders", content=json.dumps(fader())).status_code for _ in range(3)] == [200, 200, 409]
    assert len(store.listing()) == 2
    monkeypatch.setattr(store, "MAX_FADERS", 12)
    monkeypatch.setattr(store, "MAX_BYTES", 200)
    assert c.post("/dance/faders", content=json.dumps(fader())).status_code == 422 and len(store.listing()) == 2


@pytest.mark.parametrize("fid", ["f0a1b2c3", "f0a1b2c3d4", "m0a1b2c3d", "f0A1B2C3D", "..%2F..%2Fstate", "f0a1b2c3d.json"])
def test_only_a_fader_id_names_a_fader(server, store, fid):
    store.save(store.clean(fader()))
    c = client(server, "local")
    assert c.delete(f"/dance/faders/{fid}").status_code == 404 and c.post(f"/dance/faders/{fid}", content=json.dumps({"name": "x"})).status_code == 404
    assert len(store.listing()) == 1
    with pytest.raises(ValueError):
        store._path("../" + fid)


def test_a_file_changed_by_hand_into_something_else_is_not_listed(server, store):
    good, bad = store.save(store.clean(fader())), store.save(store.clean(fader(name="Two")))
    with open(store._path(bad["id"]), "w") as f:
        json.dump({**bad, "model": {**MODEL, "w": "many"}}, f)
    other = store.save(store.clean(fader(name="Three")))
    with open(store._path(other["id"]), "w") as f:
        json.dump({**other, "id": good["id"]}, f)                               # it says it is another one
    assert [f["id"] for f in store.listing()] == [good["id"]]
    with open(store._path(good["id"]), "w") as f:
        f.write("{broken")
    assert store.listing() == []
    with open(os.path.join(store.DIR, "notes.txt"), "w") as f:
        f.write("x")
    assert store.listing() == []


def test_deleting_a_fader_empties_its_base_sentences_in_the_sets_and_drafts(server, store):
    c, dance = client(server, "local"), server.dance
    fid = c.post("/dance/faders", content=json.dumps(fader())).json()["id"]
    other = c.post("/dance/faders", content=json.dumps(fader(name="Two"))).json()["id"]
    own = {"base": [{"src": "f." + fid, "fx": "waves"}, {"src": "f." + other, "fx": "trails"}], "accents": [{"src": "g.throw", "fx": "tunnel"}]}
    assert dance.save_slots_as("Mine", own, "fire") and dance.draft_slots("standard", own) and dance.use_slots("standard")
    assert any(r["src"] == "f." + fid for r in dance.tables["dance"])
    assert c.delete(f"/dance/faders/{fid}").status_code == 200
    for slots in (dance.all_slots()["Mine"], dance.load_slots()[0]["Mine"]["slots"], dance.slot_drafts["standard"]):
        assert [s and s["src"] for s in slots["base"]] == [None, "f." + other]
    assert not any(r["src"] == "f." + fid for r in dance.tables["dance"]) and any(r["src"] == "f." + other for r in dance.tables["dance"])
    assert dance.drop_source("f." + fid) is False                       # nothing left of it


@pytest.mark.parametrize("role", ["guest", "eyes", "window", "none"])
def test_a_guest_the_eyes_a_window_and_a_stranger_reach_no_fader(server, store, role):
    kept = store.save(store.clean(fader()))
    c, q = client(server, role), key_of(server, role)
    for method, path in (("GET", "/dance/faders"), ("DELETE", f"/dance/faders/{kept['id']}"), ("POST", "/dance/faders"), ("POST", f"/dance/faders/{kept['id']}")):
        r = c.request(method, path, params=q, content=json.dumps(fader(name="Other")) if method == "POST" else None)
        assert r.status_code in (401, 403), (role, method, path, r.status_code)
        assert "keys" not in r.text and "upright" not in r.text
    assert [(f["id"], f["name"]) for f in store.listing()] == [(kept["id"], "Knees")]     # still there, unchanged, nothing added


def test_control_and_this_mac_hear_which_faders_there_are_a_guest_and_the_eyes_do_not(server, store, monkeypatch):
    devices = {"mac": "local", "phone": "control", "visitor": "guest", "eyes": "eyes"}
    monkeypatch.setattr(server.hub, "clients", {d: "remote" for d in devices})
    monkeypatch.setattr(server.hub, "roles", dict(devices))
    told = []
    monkeypatch.setattr(server.hub.outbox, "post", lambda sock, data: told.append((sock, json.loads(data))) or True)
    c = client(server, "local")
    fid = c.post("/dance/faders", content=json.dumps(fader())).json()["id"]
    assert sorted(d for d, _ in told) == ["mac", "phone"]
    assert [f["id"] for f in told[0][1]["dance"]["faders"]] == [fid]
    told.clear()
    assert c.post(f"/dance/faders/{fid}", content=json.dumps({"name": "New"})).status_code == 200
    assert [m["dance"]["faders"][0]["name"] for _, m in told] == ["New", "New"]
    told.clear()
    assert server.dance.save_slots_as("Mine", {"base": [{"src": "f." + fid, "fx": "waves"}]}, "standard")
    assert c.delete(f"/dance/faders/{fid}").status_code == 200
    assert [(d, m["dance"]["faders"]) for d, m in told if "faders" in m["dance"]] == [("mac", []), ("phone", [])]
    sets = [d for d, m in told if "slots" in m["dance"]]
    assert "mac" in sets and "visitor" not in sets                        # the sets without its sentence, as after any change of them
    assert any(d == "visitor" and "tables" in m["dance"] for d, m in told)   # a guest hears the tables, never a name (#266)
    assert not [m for d, m in told if d in ("visitor", "eyes") and ("faders" in m.get("dance", {}) or "New" in json.dumps(m))]
