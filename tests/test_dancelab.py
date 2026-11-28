"""The dance lab's sessions (#243, dancelab.py): what may be kept (numbers and names only – never a picture), where it
is kept, who may list, read, add and delete, and what Dream Control hears of it."""
import json
import os

import pytest

from test_rights import client, key_of, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401  (the roles' devices; nothing left behind)

KEYS = ["energy", "open", "g.throw"]


def frame(t, g=None):
    return {"t": t, "v": [0.5, 0.25, 0.0], "c": [0.9, 0.9, 0.5], "g": g, "gc": 0.8 if g else 0, "s": 0.4, "b": 96,
            "o": {"fx.feedback": 0.7} if g else {},
            "i": {"h": {"l": [[0.4, 0.5, 0.9, 0, 0]], "r": []}, "b": [0.5, 0.4, 0.1, 0.9], "s": None, "f": {"l": 0, "r": 0}, "d": 0, "a": 1.7778},
            "p": {"b": [0.5, 0.4] * 13, "l": None, "r": None}}


def session(kind="session", n=60, marks=(), **more):
    return {"format": "dream-dance", "version": 1, "kind": kind, "rate": 30, "aspect": 1.7778, "keys": KEYS,
            "frames": [frame(round(i / 30, 5), "throw" if i > n // 3 else None) for i in range(n)],
            "marks": list(marks), "map": [{"id": "a", "src": "g.throw", "dst": "fx.feedback"}], **more}


@pytest.fixture
def lab(server):
    """The part itself – reached through the server (it hangs its routes on the app: never imported before Dream is set up)."""
    return server.dancelab


@pytest.fixture
def store(lab, monkeypatch, tmp_path):
    """… keeping its sessions in this test's own folder."""
    monkeypatch.setattr(lab, "DIR", str(tmp_path / "state" / "dance"))
    return lab


def test_sessions_live_in_the_state_folder_never_in_the_repository(lab):
    assert os.path.basename(lab.DIR) == "dance" and os.path.dirname(lab.DIR) == lab.hub.STATE_DIR
    assert not lab.DIR.startswith(os.path.dirname(os.path.abspath(lab.__file__)))


def test_a_session_is_kept_as_it_is_with_its_table_cleaned(lab):
    s = lab.clean(session(marks=[{"t": 1.5, "mark": "good", "by": "button", "secs": 4}]))
    assert s["kind"] == "session" and len(s["frames"]) == 60 and s["seconds"] == pytest.approx(59 / 30, abs=1e-4)
    assert s["frames"][30] == frame(1.0, "throw")
    assert s["marks"] == [{"t": 1.5, "mark": "good", "by": "button", "secs": 4.0}]
    assert s["map"][0]["dst"] == "fx.feedback" and s["map"][0]["curve"] == "lin"      # the table's own rules (dance.py)
    assert set(s) == {"format", "version", "kind", "rate", "aspect", "seconds", "keys", "frames", "marks", "map"}


PICTURE = "data:image/jpeg;base64," + "A" * 5000


@pytest.mark.parametrize("spoil", [
    lambda s: s.update(format="something-else"), lambda s: s.update(version=2), lambda s: s.update(kind="film"),
    lambda s: s.update(frames=[]), lambda s: s.update(frames="frames"), lambda s: s.update(keys="energy"),
    lambda s: s.update(keys=["energy", 7, "x"]), lambda s: s.update(marks={"t": 1}),
    lambda s: s.update(marks=[{"t": 1, "mark": "meh"}]), lambda s: s.update(marks=[{"t": float("nan"), "mark": "good"}]),
    lambda s: s["frames"].__setitem__(3, "frame"), lambda s: s["frames"][3].update(t=-1), lambda s: s["frames"][3].update(t="soon"),
    lambda s: s["frames"][3].update(v=[0.1]), lambda s: s["frames"][3].update(c=None),
    lambda s: s["frames"][3].update(v=[0.1, "x", 0]), lambda s: s["frames"][3].update(t=0.0),       # time runs forward
    lambda s: s["frames"][3].pop("i"), lambda s: s["frames"][3].pop("p"), lambda s: s["frames"][3]["i"].pop("h"),
    lambda s: s["frames"][3]["i"]["h"].update(l=None), lambda s: s["frames"][3]["p"].update(l=[0.1, "x"]),
    lambda s: s["frames"][3].update(v=[0.1, float("inf"), 0]), lambda s: s["frames"][3].update(v=[0.1, 10 ** 400, 0]),
    # a picture has no way in: not as a field of its own, not as a text anywhere inside a frame
    lambda s: s["frames"][3].update(jpeg=PICTURE), lambda s: s["frames"][3].update(g=PICTURE),
    lambda s: s["frames"][3]["p"].update(b=PICTURE), lambda s: s["frames"][3]["i"].update(picture=[PICTURE]),
    lambda s: s["frames"][3]["o"].update({"fx.feedback": "Sentences are no names."}),
    lambda s: s["frames"][3]["p"].update(b=list(range(5000))),
    lambda s: s["frames"][3].update(o={"a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": 1}}}}}}}}),
])
def test_what_is_not_a_session_is_not_kept(lab, spoil):
    s = session(marks=[{"t": 1.0, "mark": "bad", "by": "voice", "secs": 4}])
    assert lab.clean(s) is not None
    spoil(s)
    assert lab.clean(s) is None


@pytest.mark.parametrize("odd", [None, [], "session", 7, {"format": "dream-dance"}])
def test_anything_else_is_no_session(lab, odd):
    assert lab.clean(odd) is None


def test_a_recording_has_an_end(store):
    long = session(n=4)
    long["frames"] = long["frames"] * 3000                              # more frames than five minutes hold
    assert store.clean(long) is None


def test_keeping_listing_reading_deleting(store):
    assert store.listing() == []
    a = store.save(store.clean(session(marks=[{"t": 1.0, "mark": "good"}, {"t": 1.5, "mark": "bad"}])))
    b = store.save(store.clean(session("feedback", n=120, marks=[{"t": 3.9, "mark": "bad", "by": "control", "secs": 4}])))
    assert store.ID.fullmatch(a["id"]) and a["id"] != b["id"]
    assert (a["kind"], a["good"], a["bad"], a["frames"]) == ("session", 1, 1, 60)
    assert (b["kind"], b["good"], b["bad"], b["gesture"], b["targets"]) == ("feedback", 0, 1, "throw", ["fx.feedback"])
    assert {m["id"] for m in store.listing()} == {a["id"], b["id"]}
    for name in os.listdir(store.DIR):                                  # only the owner reads them
        assert os.stat(os.path.join(store.DIR, name)).st_mode & 0o077 == 0, name
    assert os.stat(store.DIR).st_mode & 0o077 == 0
    assert store.delete(a["id"]) and not store.delete(a["id"])
    assert [m["id"] for m in store.listing()] == [b["id"]]
    with open(os.path.join(store.DIR, "junk.meta.json"), "w") as f:     # a file that is no note of a session is passed over
        f.write("{not json")
    assert [m["id"] for m in store.listing()] == [b["id"]]


# ---------- the routes ----------
def test_the_routes_keep_and_give_back_a_session(server, store):
    c = client(server, "local")
    assert c.get("/dance/sessions").json()["sessions"] == []
    r = c.post("/dance/sessions", content=json.dumps(session(marks=[{"t": 1.0, "mark": "good", "by": "panel", "secs": 2}])))
    assert r.status_code == 200 and store.ID.fullmatch(r.json()["id"])
    sid = r.json()["id"]
    listed = c.get("/dance/sessions").json()
    assert [m["id"] for m in listed["sessions"]] == [sid] and "dance" in listed["folder"]
    got = c.get(f"/dance/sessions/{sid}")
    assert got.status_code == 200 and got.json()["frames"][0] == frame(0.0) and got.headers["cache-control"] == "no-store"
    assert c.delete(f"/dance/sessions/{sid}").json() == {"ok": True}
    assert c.get(f"/dance/sessions/{sid}").status_code == 404 and c.delete(f"/dance/sessions/{sid}").status_code == 404
    assert c.get("/dance/sessions").json()["sessions"] == []


@pytest.mark.parametrize("body", [b"", b"{not json", b"[]", b'{"format": "dream-dance"}', b"[" * 200000,
                                  json.dumps({**session(), "frames": [{**frame(0.0), "v": [float("nan")] * 3}]}).encode(),
                                  b"\xff\xfe\x00"])
def test_the_route_refuses_what_is_no_session_and_writes_nothing(server, store, body):
    r = client(server, "local").post("/dance/sessions", content=body)
    assert r.status_code == 422 and "error" in r.json()
    assert not os.path.isdir(store.DIR) or os.listdir(store.DIR) == []


def test_the_route_refuses_a_session_that_is_too_large(server, store, monkeypatch):
    monkeypatch.setattr(store, "MAX_BYTES", 2000)
    r = client(server, "local").post("/dance/sessions", content=json.dumps(session()))
    assert r.status_code == 422 and store.listing() == []


@pytest.mark.parametrize("sid", ["..%2F..%2Fcontrol-token", "nope", "20261124-120000-ab1", "20261124-120000-ab12.meta", "20261124-120000-ABCD"])
def test_only_a_session_id_names_a_session(server, store, sid):
    os.makedirs(store.DIR, exist_ok=True)
    with open(os.path.join(os.path.dirname(store.DIR), "control-token"), "w") as f:
        f.write("a-secret")
    c = client(server, "local")
    r = c.get(f"/dance/sessions/{sid}")
    assert r.status_code == 404 and "a-secret" not in r.text
    assert c.delete(f"/dance/sessions/{sid}").status_code == 404
    assert os.path.exists(os.path.join(os.path.dirname(store.DIR), "control-token"))


# ---------- a test file for the detection: real movement, written to the state folder and nowhere else ----------
def testfile(n=30, **more):
    return {"format": "dream-dance-test", "version": 1, "name": "anything", "rate": 30, "aspect": 1.7778, "seconds": 1,
            "frames": [{"t": round(i / 30, 5), "i": frame(0)["i"], "p": {"l": None, "r": None}} for i in range(n)],
            "expect": [{"t0": 0, "t1": 0.9, "mark": "good", "was": "throw", "want": "throw"}, {"t0": 0.2, "t1": 0.9, "mark": "bad", "was": None, "want": None}], **more}


def files_under(folder):
    return sorted(os.path.relpath(os.path.join(d, n), folder) for d, _, names in os.walk(folder) for n in names)


def test_a_test_file_is_written_to_the_exports_folder_in_the_state_folder_and_nowhere_else(server, store, monkeypatch, tmp_path):
    repo = os.path.dirname(os.path.abspath(store.__file__))
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.chdir(work)                              # wherever Dream runs from: nothing lands there
    before = files_under(os.path.join(repo, "tests", "js", "dance-sessions"))
    meta = store.save(store.clean(session()))
    c = client(server, "local")
    r = c.post(f"/dance/sessions/{meta['id']}/export", content=json.dumps(testfile()))
    assert r.status_code == 200, r.text
    path = os.path.join(store.DIR, "exports", f"dance-{meta['id']}.json")
    assert r.json() == {"file": store.paths.shown(path), "folder": store.paths.shown(os.path.dirname(path))}
    assert store.exports_dir() == os.path.join(store.DIR, "exports") and not store.exports_dir().startswith(repo + os.sep)
    with open(path) as f:
        kept = json.load(f)
    assert kept["name"] == meta["id"] and len(kept["frames"]) == 30 and kept["expect"][1]["want"] is None
    assert os.stat(path).st_mode & 0o777 == 0o600 and os.stat(os.path.dirname(path)).st_mode & 0o777 == 0o700
    assert files_under(str(tmp_path / "state")) == sorted([f"dance/{meta['id']}.json", f"dance/{meta['id']}.meta.json", f"dance/exports/dance-{meta['id']}.json"])
    assert os.listdir(work) == [] and files_under(os.path.join(repo, "tests", "js", "dance-sessions")) == before
    assert [m["id"] for m in store.listing()] == [meta["id"]]            # an export is no session


def test_what_the_lab_makes_of_a_session_is_a_test_file(lab):
    """The file the page's own code made (static/dancerec.js `testFile`, kept as the synthetic test file) passes as it is."""
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "js", "dance-sessions", "synthetic.json")) as f:
        made = json.load(f)
    kept = lab.clean_test(made, "20261124-120000-ab12")
    assert kept and kept["frames"] == made["frames"] and kept["expect"] == made["expect"] and kept["name"] == "20261124-120000-ab12"


@pytest.mark.parametrize("body", [b"", b"{not json", json.dumps(session()).encode(), json.dumps(testfile(frames=[])).encode(),
                                  json.dumps(testfile(expect=[{"t0": 0, "t1": 1, "mark": "good", "was": None, "want": "data:image/png;base64,AAAA"}])).encode(),
                                  json.dumps({**testfile(), "frames": [{"t": 0, "i": {}, "p": {}, "picture": "x"}]}).encode()])
def test_what_is_no_test_file_is_not_written(server, store, body):
    meta = store.save(store.clean(session()))
    r = client(server, "local").post(f"/dance/sessions/{meta['id']}/export", content=body)
    assert r.status_code == 422 and "error" in r.json()
    assert not os.path.exists(store.exports_dir())


@pytest.mark.parametrize("sid", ["..%2F..%2Fcontrol-token", "nope", "20261124-120000-ab12"])
def test_a_test_file_is_only_written_for_a_session_that_is_kept(server, store, sid):
    r = client(server, "local").post(f"/dance/sessions/{sid}/export", content=json.dumps(testfile()))
    assert r.status_code == 404 and not os.path.exists(store.exports_dir())
    with pytest.raises(ValueError):
        store.export("../../outside", testfile())


def test_the_repository_ignores_test_files_of_real_sessions():
    """An exported file is named dance-<id>.json; should one ever be copied into the code folder, git does not take it."""
    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".gitignore")) as f:
        assert "tests/js/dance-sessions/*" in f.read().split()


@pytest.mark.parametrize("role", ["guest", "eyes", "window", "none"])
def test_a_guest_the_eyes_a_window_and_a_stranger_reach_no_session(server, store, role):
    meta = store.save(store.clean(session()))
    c = client(server, role)
    q = key_of(server, role)
    for method, path in (("GET", "/dance/sessions"), ("GET", f"/dance/sessions/{meta['id']}"), ("DELETE", f"/dance/sessions/{meta['id']}"),
                         ("POST", "/dance/sessions"), ("POST", f"/dance/sessions/{meta['id']}/export")):
        r = c.request(method, path, params=q, content=json.dumps(session()) if method == "POST" else None)
        assert r.status_code in (401, 403), (role, method, path, r.status_code)
        assert "frames" not in r.text
    assert [m["id"] for m in store.listing()] == [meta["id"]]            # still there, and nothing added
    assert not os.path.exists(store.exports_dir())


def test_control_and_this_mac_hear_that_a_moment_was_kept_a_guest_and_the_eyes_do_not(server, store, monkeypatch):
    devices = {"mac": "local", "phone": "control", "visitor": "guest", "eyes": "eyes"}
    monkeypatch.setattr(server.hub, "clients", {d: "remote" for d in devices})
    monkeypatch.setattr(server.hub, "roles", dict(devices))
    told = []
    monkeypatch.setattr(server.hub.outbox, "post", lambda sock, data: told.append((sock, json.loads(data))) or True)
    r = client(server, "local").post("/dance/sessions", content=json.dumps(
        session("feedback", marks=[{"t": 1.9, "mark": "good", "by": "control", "secs": 4}])))
    assert r.status_code == 200
    assert sorted(d for d, _ in told) == ["mac", "phone"]
    note = told[0][1]["dance"]["saved"]
    assert (note["id"], note["kind"], note["good"], note["bad"]) == (r.json()["id"], "feedback", 1, 0)
    assert "frames" in note and not isinstance(note["frames"], list)        # how many, never the frames themselves
    told.clear()
    assert client(server, "local").delete(f"/dance/sessions/{note['id']}").status_code == 200
    assert [(d, m) for d, m in told] == [("mac", {"dance": {"deleted": note["id"]}}), ("phone", {"dance": {"deleted": note["id"]}})]


def test_the_stage_tells_whether_the_lab_is_open_and_only_the_stage(server, monkeypatch, saved_state):
    monkeypatch.setattr(server.hub, "live", dict(server.hub.live))
    with client(server, "local").websocket_connect(ws_url(server, "/ctl", "local") + "?role=stage") as stage:
        stage.receive_json()
        stage.send_text(json.dumps({"dance_lab": {"open": True, "rec": 1, "play": None, "more": "x" * 500}}))
        wait_until(lambda: server.hub.live.get("dance_lab") == {"open": True, "rec": True, "play": False})
        with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as ctl:
            first = [ctl.receive_json() for _ in range(6)]
            assert any(m.get("dance", {}).get("lab") == {"open": True, "rec": True, "play": False} for m in first)
            ctl.send_text(json.dumps({"dance_lab": {"open": False}}))     # Dream Control is not the stage: not taken
            ctl.send_text(json.dumps({"set": {"prompt": "after"}}))
            wait_until(lambda: server.hub.state["prompt"] == "after")
            assert server.hub.live["dance_lab"]["open"] is True
    wait_until(lambda: "dance_lab" not in server.hub.live)               # the stage is gone: so is its lab


def test_feedback_is_a_midi_action_and_not_a_guests_command(server):
    assert {"dance_good", "dance_bad"} <= set(server.inputs.midi.ACTIONS)
    assert not {"dance_fb", "dance_rec", "dance_lab"} & server.rights.GUEST_CMDS
    assert "dance_fb_secs" not in server.settings.GUEST_KEYS
    assert server.settings.coerce("dance_fb_secs", 99) == 15.0 and server.settings.DEFAULT_STATE["dance_fb_secs"] == 4.0


# ---------- #196: the motion sensor's raw values with their times ----------
def test_a_session_keeps_the_sensor_raw_values_and_refuses_odd_ones(lab):
    s = session()
    s["frames"][5]["i"]["r"] = [[-0.02, 2, 1.25, -0.5, 0.0], [-0.001, 0, 0.1, 9.8, 0.2]]
    kept = lab.clean(s)
    assert kept["frames"][5]["i"]["r"] == [[-0.02, 2, 1.25, -0.5, 0.0], [-0.001, 0, 0.1, 9.8, 0.2]]
    for odd in ([[-0.02, 9, 0, 0, 0]], [[0.5, 2, 0, 0, 0]], [[-0.02, 2, 0, 0]], [[-0.02, 2, 0, 0, "x"]], "r",
                [[-0.01, 2, 0, 0, 0]] * (lab.RAW_MAX + 1)):
        s["frames"][5]["i"]["r"] = odd
        assert lab.clean(s) is None, odd
