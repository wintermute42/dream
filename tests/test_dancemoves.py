"""Dance moves of one's own (#236, dancemoves.py): what may be kept of a taught move (numbers and names only – never a
picture), where it is kept, who may list, read, add, rename and delete, what the stage and Dream Control hear of it,
and that a deleted move takes its rows of the mapping tables along."""
import json
import os

import pytest

from test_dancelab import KEYS, PICTURE, frame
from test_rights import client, key_of, no_ghost_sockets, saved_state  # noqa: F401  (the roles' devices; nothing left behind)

TPL = {"v": 1, "period": 0.6, "hands": "lr", "tol": 0.1, "pts": [[0.7, round(0.1 * (i % 5), 4), -0.7, round(-0.1 * (i % 3), 4)] for i in range(24)]}


def rep(n=18):
    return {"frames": [{**frame(round(i / 30, 5)), "u": [0.7, 0.1, -0.7, None if i == 3 else 0.2], "k": 0} for i in range(n)]}


def move(reps=4, **more):
    return {"format": "dream-dance-move", "version": 1, "name": "Lasso", "piece": "fire", "rate": 30, "aspect": 1.7778, "keys": KEYS,
            "tpl": json.loads(json.dumps(TPL)), "reps": [rep() for _ in range(reps)], **more}


@pytest.fixture
def store(server, monkeypatch, tmp_path):
    """The part itself, keeping its moves in this test's own folder, with the built-in tables."""
    monkeypatch.setattr(server.dancemoves, "DIR", str(tmp_path / "state" / "dance" / "moves"))
    monkeypatch.setattr(server.dance, "MAP_FILE", str(tmp_path / "config" / "dance.json"))
    monkeypatch.setattr(server.dance, "tables", server.dance.default_tables())
    for name, value in (("slot_sets", {}), ("slot_use", "standard"), ("slot_drafts", {})):
        monkeypatch.setattr(server.dance, name, value)
    return server.dancemoves


def test_moves_live_in_the_state_folder_beside_the_sessions_never_in_the_repository(server):
    m = server.dancemoves
    assert m.DIR == os.path.join(server.dancelab.DIR, "moves") and m.DIR.startswith(server.hub.STATE_DIR + os.sep)
    assert not m.DIR.startswith(os.path.dirname(os.path.abspath(m.__file__)))
    assert m.MAX_MOVES == 24 and m.POINTS == 24                 # static/dance.js MAX_MOVES, static/dancemoves.js M
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(here, "static", "dance.js")) as f:
        assert "const MAX_MOVES = 24;" in f.read()
    with open(os.path.join(here, "static", "dancemoves.js")) as f:
        assert "M = 24;" in f.read()


def test_a_move_is_kept_as_its_repetitions_and_a_small_note(store):
    m = store.clean(move())
    assert m["meta"] == {"name": "Lasso", "piece": "fire", "reps": 4, "tpl": TPL}
    assert set(m["reps"]) == {"format", "version", "rate", "aspect", "keys", "reps"} and len(m["reps"]["reps"]) == 4
    first = m["reps"]["reps"][0]
    assert first["seconds"] == pytest.approx(17 / 30, abs=1e-4)
    assert first["frames"][3] == {**frame(0.1), "u": [0.7, 0.1, -0.7, None], "k": 0}      # a session's frame (#243), the hands, the clutch
    assert store.clean(move(name="  Big   Wave 2 ", piece=""))["meta"]["name"] == "Big Wave 2"


@pytest.mark.parametrize("spoil", [
    lambda m: m.update(format="dream-dance"), lambda m: m.update(version=2), lambda m: m.update(name=""), lambda m: m.update(name="x" * 33),
    lambda m: m.update(name="<b>"), lambda m: m.update(name=7), lambda m: m.update(name="a\nb\x00"), lambda m: m.update(piece="x" * 81),
    lambda m: m.update(piece="<script>"), lambda m: m.update(piece=None), lambda m: m.update(keys="energy"),
    lambda m: m.update(reps=[]), lambda m: m.update(reps=[rep()] * 2), lambda m: m.update(reps=[rep()] * 6), lambda m: m.update(reps="reps"),
    lambda m: m["reps"].__setitem__(1, "rep"), lambda m: m["reps"][1].update(frames=[]), lambda m: m["reps"].__setitem__(1, rep(65)),
    lambda m: m["reps"][1]["frames"][2].pop("u"), lambda m: m["reps"][1]["frames"][2].update(u=[0.1, 0.2]),
    lambda m: m["reps"][1]["frames"][2].update(u=[0.1, "x", 0, 0]), lambda m: m["reps"][1]["frames"][2].update(t=0.0),
    lambda m: m["reps"][1]["frames"][2].update(v=[0.1]), lambda m: m["reps"][1]["frames"][2].pop("i"),
    # a picture has no way in
    lambda m: m["reps"][1]["frames"][2].update(jpeg=PICTURE), lambda m: m["reps"][1]["frames"][2].update(k=PICTURE),
    lambda m: m["reps"][1]["frames"][2]["p"].update(b=PICTURE), lambda m: m["reps"][1]["frames"][2].update(u=[PICTURE] * 4),
    lambda m: m.update(tpl=None), lambda m: m["tpl"].update(v=2), lambda m: m["tpl"].update(hands="both"), lambda m: m["tpl"].update(period=5),
    lambda m: m["tpl"].update(period="fast"), lambda m: m["tpl"].update(tol=float("nan")), lambda m: m["tpl"].update(pts=m["tpl"]["pts"][:23]),
    lambda m: m["tpl"]["pts"].__setitem__(4, [0, 0, 0]), lambda m: m["tpl"]["pts"].__setitem__(4, [0, 0, 0, PICTURE]),
    lambda m: m["tpl"]["pts"].__setitem__(4, [0, 0, 0, 1e9]), lambda m: m["tpl"]["pts"].__setitem__(4, [0, 0, 0, True]),
])
def test_what_is_not_a_move_is_not_kept(store, spoil):
    m = move()
    spoil(m)
    assert store.clean(m) is None


@pytest.mark.parametrize("odd", [None, [], "move", 7, {"format": "dream-dance-move"}])
def test_anything_else_is_no_move(store, odd):
    assert store.clean(odd) is None


def test_the_routes_keep_list_give_back_rename_and_delete_a_move(server, store):
    c = client(server, "local")
    assert c.get("/dance/moves").json()["moves"] == []
    r = c.post("/dance/moves", content=json.dumps(move()))
    assert r.status_code == 200 and store.ID.fullmatch(r.json()["id"])
    mid = r.json()["id"]
    listed = c.get("/dance/moves").json()
    assert [(m["id"], m["name"], m["piece"], m["reps"], m["tpl"]) for m in listed["moves"]] == [(mid, "Lasso", "fire", 4, TPL)]
    assert listed["folder"].endswith(os.path.join("dance", "moves")) and "frames" not in json.dumps(listed)
    got = c.get(f"/dance/moves/{mid}")
    assert got.status_code == 200 and len(got.json()["reps"]) == 4 and got.headers["cache-control"] == "no-store"
    assert sorted(os.listdir(store.DIR)) == [f"{mid}.json", f"{mid}.meta.json"]
    assert oct(os.stat(os.path.join(store.DIR, f"{mid}.json")).st_mode & 0o777) == "0o600"
    r = c.post(f"/dance/moves/{mid}", content=json.dumps({"name": "Water", "piece": "deep water, waves"}))
    assert r.status_code == 200 and (r.json()["name"], r.json()["piece"], r.json()["tpl"]) == ("Water", "deep water, waves", TPL)
    assert c.post(f"/dance/moves/{mid}", content=json.dumps({"piece": ""})).json()["name"] == "Water"
    assert c.get("/dance/moves").json()["moves"][0]["piece"] == ""
    for bad in ({"name": ""}, {"name": "<i>"}, {"piece": "x" * 81}, [], "name"):
        assert c.post(f"/dance/moves/{mid}", content=json.dumps(bad)).status_code == 422
    assert c.get("/dance/moves").json()["moves"][0]["name"] == "Water"
    assert c.delete(f"/dance/moves/{mid}").json() == {"ok": True}
    assert c.get(f"/dance/moves/{mid}").status_code == 404 and c.delete(f"/dance/moves/{mid}").status_code == 404
    assert c.post(f"/dance/moves/{mid}", content=json.dumps({"name": "x"})).status_code == 404
    assert c.get("/dance/moves").json()["moves"] == [] and os.listdir(store.DIR) == []


@pytest.mark.parametrize("body", [b"", b"{not json", b"[]", b'{"format": "dream-dance-move"}', b"[" * 200000, b"\xff\xfe\x00",
                                  json.dumps({**move(), "tpl": {**TPL, "period": float("nan")}}).encode()])
def test_the_route_refuses_what_is_no_move_and_writes_nothing(server, store, body):
    r = client(server, "local").post("/dance/moves", content=body)
    assert r.status_code == 422 and "error" in r.json()
    assert not os.path.isdir(store.DIR) or os.listdir(store.DIR) == []


def test_there_is_an_end_to_the_moves_and_to_their_size(server, store, monkeypatch):
    c = client(server, "local")
    monkeypatch.setattr(store, "MAX_MOVES", 2)
    assert [c.post("/dance/moves", content=json.dumps(move())).status_code for _ in range(3)] == [200, 200, 409]
    assert len(store.listing()) == 2
    monkeypatch.setattr(store, "MAX_MOVES", 24)
    monkeypatch.setattr(store, "MAX_BYTES", 2000)
    assert c.post("/dance/moves", content=json.dumps(move())).status_code == 422 and len(store.listing()) == 2


@pytest.mark.parametrize("mid", ["m0a1b2c3", "m0a1b2c3d4", "x0a1b2c3d", "m0A1B2C3D", "..%2F..%2Fstate", "m0a1b2c3d.meta"])
def test_only_a_move_id_names_a_move(server, store, mid):
    store.save(store.clean(move()))
    c = client(server, "local")
    assert c.get(f"/dance/moves/{mid}").status_code == 404 and c.delete(f"/dance/moves/{mid}").status_code == 404
    assert len(store.listing()) == 1
    with pytest.raises(ValueError):
        store._path("../" + mid)


def test_a_note_changed_by_hand_into_something_else_is_not_listed(server, store):
    good, bad = store.save(store.clean(move())), store.save(store.clean(move(name="Two")))
    with open(store._path(bad["id"], True), "w") as f:
        json.dump({**bad, "tpl": {**TPL, "pts": "many"}, "name": "<img>"}, f)
    assert [m["id"] for m in store.listing()] == [good["id"]]
    with open(store._path(good["id"], True), "w") as f:
        f.write("{broken")
    assert store.listing() == []


def test_deleting_a_move_takes_its_rows_out_of_the_tables_and_its_accents_out_of_the_sets(server, store):
    c, dance = client(server, "local"), server.dance
    mid = c.post("/dance/moves", content=json.dumps(move())).json()["id"]
    other = c.post("/dance/moves", content=json.dumps(move(name="Two"))).json()["id"]
    row = lambda m, dst: {"id": m, "on": True, "src": "g." + m, "dst": dst, "curve": "lin", "in": [0, 1], "out": [0, 1], "smooth": 0.15, "origin": "taught"}  # noqa: E731
    rows = dance.set_rows(dance.tables["flowtrack"] + [row(mid, "fx.tunnel"), row(other, "ai.piece")], "flowtrack")
    assert [r["origin"] for r in rows[-2:]] == ["taught", "taught"] and rows[-1]["dst"] == "ai.piece"
    # #265: the dance's moves are accents of its sets – an own set, and the draft of a built-in one
    own = {"accents": [{"src": "g." + mid, "fx": "rgb"}, {"src": "g." + other, "fx": "glitch"}]}
    assert dance.save_slots_as("Mine", own, "fire") and dance.draft_slots("standard", own)
    n = len(rows)
    assert c.delete(f"/dance/moves/{mid}").status_code == 200
    for table in (dance.tables["flowtrack"], dance.load_tables()["flowtrack"]):
        assert len(table) == n - 1 and not any(r["src"] == "g." + mid for r in table) and any(r["src"] == "g." + other for r in table)
    for slots in (dance.all_slots()["Mine"], dance.load_slots()[0]["Mine"]["slots"], dance.slot_drafts["standard"]):
        assert [a and a["src"] for a in slots["accents"][:2]] == [None, "g." + other]
    assert not any(r["src"] == "g." + mid for r in dance.tables["dance"]) and any(r["src"] == "g." + other for r in dance.tables["dance"])
    assert dance.drop_source("g." + mid) is False                       # nothing left of it


@pytest.mark.parametrize("role", ["guest", "eyes", "window", "none"])
def test_a_guest_the_eyes_a_window_and_a_stranger_reach_no_move(server, store, role):
    meta = store.save(store.clean(move()))
    c, q = client(server, role), key_of(server, role)
    for method, path in (("GET", "/dance/moves"), ("GET", f"/dance/moves/{meta['id']}"), ("DELETE", f"/dance/moves/{meta['id']}"),
                         ("POST", "/dance/moves"), ("POST", f"/dance/moves/{meta['id']}")):
        r = c.request(method, path, params=q, content=json.dumps(move(name="Other")) if method == "POST" else None)
        assert r.status_code in (401, 403), (role, method, path, r.status_code)
        assert "frames" not in r.text and "pts" not in r.text
    assert [(m["id"], m["name"]) for m in store.listing()] == [(meta["id"], "Lasso")]     # still there, unchanged, nothing added


def test_control_and_this_mac_hear_which_moves_there_are_a_guest_and_the_eyes_do_not(server, store, monkeypatch):
    devices = {"mac": "local", "phone": "control", "visitor": "guest", "eyes": "eyes"}
    monkeypatch.setattr(server.hub, "clients", {d: "remote" for d in devices})
    monkeypatch.setattr(server.hub, "roles", dict(devices))
    told = []
    monkeypatch.setattr(server.hub.outbox, "post", lambda sock, data: told.append((sock, json.loads(data))) or True)
    c = client(server, "local")
    mid = c.post("/dance/moves", content=json.dumps(move())).json()["id"]
    assert sorted(d for d, _ in told) == ["mac", "phone"]
    assert [m["id"] for m in told[0][1]["dance"]["moves"]] == [mid] and "frames" not in json.dumps(told)
    told.clear()
    assert c.post(f"/dance/moves/{mid}", content=json.dumps({"name": "New"})).status_code == 200
    assert [m["dance"]["moves"][0]["name"] for _, m in told] == ["New", "New"]
    told.clear()
    server.dance.set_rows(server.dance.tables["mood"] + [{"id": mid, "src": "g." + mid, "dst": "fx.rgb"}], "mood")
    assert c.delete(f"/dance/moves/{mid}").status_code == 200
    moves = [(d, m["dance"]["moves"]) for d, m in told if "moves" in m["dance"]]
    assert moves == [("mac", []), ("phone", [])]
    tables = [d for d, m in told if "tables" in m["dance"]]
    assert "mac" in tables and "eyes" not in tables                      # the table without the move's row, as after any change of it
