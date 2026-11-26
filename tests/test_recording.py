"""#276: recording the output (recording.py). The stage hands its video in, piece by piece: every piece is appended to
the file in the save folder at once and in order; a recording ends cleanly, after 15 minutes by itself or – the stage
gone – after a silence, and what is on disk stays a playable file; the disk is never filled up; only the stage on this Mac hands video in, and only this Mac
and Dream Control start or stop (guests nothing). With ffmpeg at hand a real video is cut into pieces, handed in and
checked with ffprobe."""
import json
import os
import shutil
import subprocess
import time

import pytest

from test_rights import client, no_ghost_sockets, saved_state, wait_until, ws_url  # noqa: F401

GB = 1024 ** 3
REAL: dict = {}                                       # recording.remux as it is (the fixture puts a stand-in in its place)


@pytest.fixture
def rec(server, monkeypatch, sandbox):
    """recording.py with plenty of room on the disk, no ffmpeg tidying, and nothing left over from another test."""
    r = server.recording
    REAL.setdefault("remux", r.remux)
    monkeypatch.setattr(r, "free_bytes", lambda: 100 * GB)
    monkeypatch.setattr(r, "remux", lambda path: None)
    r.finish("stop")
    r.done.clear()
    r.note.update(error="", free=None)
    yield r
    r.finish("stop")
    r.done.clear()


def start(c, mime="video/webm;codecs=vp8,opus", pw=512, ph=512, audio=True):
    return c.post("/rec/start", content=json.dumps({"pw": pw, "ph": ph, "mime": mime, "audio": audio}))


def chunk(c, pid, seq, data: bytes):
    return c.post(f"/rec/chunk/{pid}?seq={seq}", content=data, headers={"Content-Type": "application/octet-stream"})


def test_size_and_bit_rate_are_dreams_choice(server):
    r = server.recording
    assert r.frame_size(512, 512, "video/mp4;codecs=avc1") == (1080, 1080)
    assert r.frame_size(896, 512, "video/mp4") == (1890, 1080)          # 16:9 of the AI, as large as fits 1080p, even
    assert r.frame_size(1344, 768, "video/webm;codecs=vp9") == (1260, 720)   # WebM (the processor encodes): 720p at most
    assert r.frame_size("odd", None, "video/mp4") == (1920, 1080)       # nonsense from the page: 16:9
    assert r.video_bps("standard", 1920, 1080) == 8_000_000
    assert r.video_bps("low", 1920, 1080) == 4_000_000 and r.video_bps("high", 1920, 1080) == 16_000_000
    assert r.video_bps("standard", 1080, 1080) == round(8_000_000 * 1080 * 1080 / (1920 * 1080))
    assert r.video_bps("high", 64, 64) == 1_000_000                    # never starved
    assert r.video_bps("nonsense", 1920, 1080) == 8_000_000
    # the room left: what is free above the stop line, at the bytes a second of the quality
    assert r.minutes_left(r.STOP_FREE + 60 * 1_000_000, 1_000_000) == 1
    assert r.minutes_left(r.STOP_FREE // 2, 1_000_000) == 0


def test_quality_and_sound_are_settings_never_a_guests(server):
    s = server.settings
    assert s.SETTINGS["rec_quality"].default == "standard" and s.SETTINGS["rec_quality"].choices == ("low", "standard", "high")
    assert s.SETTINGS["rec_audio"].default is False
    assert not {"rec_quality", "rec_audio"} & s.GUEST_KEYS and not {"rec_quality", "rec_audio"} & set(s.TARGETS)
    assert "rec" in server.inputs.midi.ACTIONS


def test_a_take_is_appended_piece_by_piece_and_joined_in_order(server, rec, sandbox, saved_state):
    saved_state["rec_quality"] = "high"
    c = client(server, "local")
    r = start(c)
    assert r.status_code == 200, r.text
    j = r.json()
    assert (j["w"], j["h"]) == (720, 720) and j["bps"] == server.recording.video_bps("high", 720, 720) and j["abps"] == 128_000
    assert j["max_secs"] == 15 * 60
    assert start(c).status_code == 409                                 # one take at a time (a second stage: refused)
    path = os.path.join(sandbox["DREAM_SAVE_DIR"], j["name"])
    assert j["name"].startswith("dream-rec-") and j["name"].endswith(".webm") and os.path.isfile(path)
    pieces = [b"\x1aE\xdf\xa3head", b"cluster-1" * 100, b"cluster-2" * 50]
    for i, p in enumerate(pieces):
        assert chunk(c, j["id"], i, p).json()["ok"]
        assert open(path, "rb").read() == b"".join(pieces[:i + 1])      # on disk at once: a crash loses nothing of it
    assert chunk(c, j["id"], 1, b"twice").json().get("again")          # an answer lost, sent again: not written twice
    assert chunk(c, j["id"], 5, b"gap").status_code == 409             # a piece missing: refused, the file stays whole
    st = server.recording.status()["rec"]
    assert st["on"] and st["left"] == 15 * 60 and st["bytes"] == sum(map(len, pieces)) and st["kind"] == "webm"
    assert c.post(f"/rec/end/{j['id']}").json()["last"]["name"] == j["name"]
    assert open(path, "rb").read() == b"".join(pieces)
    st = server.recording.status()["rec"]
    assert not st["on"] and st["last"]["bytes"] == sum(map(len, pieces)) and st["last"]["reason"] == "stop"
    assert chunk(c, j["id"], 3, b"late").status_code == 410            # the take is over


def test_a_recording_ends_by_itself_after_15_minutes(server, rec, sandbox):
    r, c = server.recording, client(server, "local")
    j = start(c, mime="video/mp4;codecs=avc1.640028,mp4a.40.2").json()
    assert j["name"].endswith(".mp4") and (j["w"], j["h"]) == (1080, 1080)
    assert "stop" not in chunk(c, j["id"], 0, b"one").json()
    r.take["t0"] -= r.MAX_SECS + 1                                     # 15 minutes later
    assert r.status()["rec"]["left"] == 0
    assert chunk(c, j["id"], 1, b"two").json()["stop"] == "time"     # the time is up: the stage is asked to stop
    assert chunk(c, j["id"], 2, b"-end").json()["ok"]                 # its last piece still comes in
    assert c.post(f"/rec/end/{j['id']}?reason=time").json()["last"]["reason"] == "time"
    assert open(os.path.join(sandbox["DREAM_SAVE_DIR"], j["name"]), "rb").read() == b"onetwo-end"
    assert len(os.listdir(sandbox["DREAM_SAVE_DIR"])) == 1           # one file – never a second part


def test_a_stage_that_does_not_stop_is_stopped_by_dream(server, rec):
    r, c = server.recording, client(server, "local")
    j = start(c).json()
    chunk(c, j["id"], 0, b"x")
    r.take["t0"] -= r.MAX_SECS + r.GRACE_SECS + 1                      # long past the 15 minutes
    res = chunk(c, j["id"], 1, b"more")
    assert res.status_code == 409 and res.json()["stop"] == "time"
    st = r.status()["rec"]
    assert not st["on"] and st["last"]["reason"] == "time" and st["last"]["bytes"] == 1
    j = start(c).json()                                               # … and the watch, if the stage goes on sending nothing
    chunk(c, j["id"], 0, b"y")
    r.take["t0"] -= r.MAX_SECS + r.GRACE_SECS + 1
    r.watch(time.monotonic())
    assert r.status()["rec"]["last"]["reason"] == "time"


def test_a_recording_that_got_nothing_leaves_no_file(server, rec, sandbox):
    c = client(server, "local")
    j = start(c).json()
    c.post(f"/rec/end/{j['id']}")
    assert not os.listdir(sandbox["DREAM_SAVE_DIR"])
    assert server.recording.status()["rec"]["last"]["name"] == ""


def test_a_stage_that_went_away_ends_the_take_and_keeps_the_file(server, rec, sandbox):
    c = client(server, "local")
    j = start(c).json()
    chunk(c, j["id"], 0, b"until here")
    r = server.recording
    r.watch(time.monotonic() + 1)                                     # a second without a piece: nothing happens
    assert r.status()["rec"]["on"]
    r.watch(time.monotonic() + r.SILENT_SECS + 1)
    st = r.status()["rec"]
    assert not st["on"] and st["error"] == "interrupted" and st["last"]["reason"] == "interrupted"
    assert open(os.path.join(sandbox["DREAM_SAVE_DIR"], j["name"]), "rb").read() == b"until here"


def test_the_disk_is_never_filled_up(server, rec, monkeypatch):
    r, c = server.recording, client(server, "local")
    monkeypatch.setattr(r, "free_bytes", lambda: r.STOP_FREE + 100)    # too little to begin
    assert start(c).status_code == 507 and r.status()["rec"]["error"] == "disk"
    free = {"n": 100 * GB}
    monkeypatch.setattr(r, "free_bytes", lambda: free["n"])
    j = start(c).json()
    assert "stop" not in chunk(c, j["id"], 0, b"x" * 10).json()
    free["n"] = r.STOP_FREE + 5                                        # below the line: the stage is asked to stop
    assert chunk(c, j["id"], 1, b"x" * 10).json()["stop"] == "disk"
    assert r.status()["rec"]["warn"] == "disk"
    free["n"] = r.HARD_FREE + 5                                        # nearly full: nothing more is written
    res = chunk(c, j["id"], 2, b"x" * 10)
    assert res.status_code == 507 and res.json()["stop"] == "disk"
    st = r.status()["rec"]
    assert not st["on"] and st["last"]["bytes"] == 20 and st["last"]["reason"] == "disk"


def test_pieces_and_names_are_checked_fail_closed(server, rec, monkeypatch):
    r, c = server.recording, client(server, "local")
    assert start(c, mime="text/html").status_code == 415
    assert start(c, mime="video/mp4;codecs=avc1\"><script>").status_code == 415
    j = start(c).json()
    monkeypatch.setattr(r, "CHUNK_MAX", 16)
    assert chunk(c, j["id"], 0, b"x" * 17).status_code == 413          # too large a piece
    for pid in ("..%2F..%2Fstate", "0123456789ABCDEF", "nope"):
        assert chunk(c, pid, 0, b"x").status_code in (404, 410)
        assert c.post(f"/rec/end/{pid}").status_code in (404, 410)
    assert r.status()["rec"]["bytes"] == 0


def test_status_tells_the_room_left_at_the_chosen_quality(server, rec, saved_state, monkeypatch):
    r = server.recording
    saved_state.update(rec_quality="standard", rec_audio=False, aspect="wide")
    monkeypatch.setattr(r, "free_bytes", lambda: r.STOP_FREE + 60 * 1_000_000)   # a minute at 8 Mbit/s
    r.tell()
    st = r.status()["rec"]
    assert st["left_min"] == 1 and not st["on"]
    saved_state["rec_quality"] = "low"
    r.tell()
    assert r.status()["rec"]["left_min"] == 2


def test_reveal_shows_only_the_file_dream_wrote(server, rec, monkeypatch):
    c, calls = client(server, "local"), []
    monkeypatch.setattr(server.recording.subprocess, "Popen", lambda args, **kw: calls.append(args))
    monkeypatch.setattr(server.recording.sys, "platform", "darwin")
    assert c.post("/rec/reveal").status_code == 404                     # nothing recorded yet
    j = start(c).json()
    chunk(c, j["id"], 0, b"x")
    c.post(f"/rec/end/{j['id']}")
    assert c.post("/rec/reveal", content=json.dumps({"path": "/etc/passwd"})).json()["ok"]
    assert calls == [["open", "-R", server.recording.done["path"]]] and calls[0][2].endswith(j["name"])
    monkeypatch.setattr(server.recording.sys, "platform", "linux")
    assert c.post("/rec/reveal").status_code == 404                     # only on this Mac


# ---------- who may start and stop ----------
@pytest.mark.parametrize("role,may", [("local", True), ("control", True), ("guest", False)])
def test_only_this_mac_and_dream_control_start_or_stop(server, rec, saved_state, monkeypatch, role, may):
    calls = []

    async def command(arg, by=None):
        calls.append(arg)
    monkeypatch.setattr(server.recording, "command", command)
    path = ws_url(server, "/ctl", role)
    with client(server, role).websocket_connect(path) as ws:
        ws.receive_json()
        ws.send_text(json.dumps({"cmd": "rec", "arg": "start"}))
        ws.send_text(json.dumps({"set": {"prompt": f"after rec {role}"}}))   # a marker every role may send
        wait_until(lambda: server.hub.state["prompt"] == f"after rec {role}")
    assert calls == (["start"] if may else [])


def test_the_command_goes_to_the_stage_and_says_when_there_is_none(server, rec, saved_state):
    r = server.recording
    with client(server, "control").websocket_connect(ws_url(server, "/ctl", "control")) as phone:
        phone.receive_json()
        phone.send_text(json.dumps({"cmd": "rec", "arg": "toggle"}))   # no stage open: Dream says so
        wait_until(lambda: r.note["error"] == "nostage")
        with client(server, "local").websocket_connect(ws_url(server, "/ctl", "local") + "?role=stage") as stage:
            phone.send_text(json.dumps({"cmd": "rec", "arg": "toggle"}))
            for _ in range(60):
                m = stage.receive_json()
                if m.get("cmd") == "rec":
                    break
            assert m["arg"] == "start" and m["by"] == "remote"
            stage.send_text(json.dumps({"rec_error": "nosupport"}))     # the stage cannot record: the pages hear why
            wait_until(lambda: r.note["error"] == "nosupport")
            stage.send_text(json.dumps({"rec_error": {"no": "text"}}))  # anything odd is not taken
            stage.send_text(json.dumps({"rec_error": "x" * 99}))
            time.sleep(0.1)
            assert r.note["error"] == "nosupport"


def test_guests_and_the_eyes_never_hear_the_recording(server, rec, monkeypatch, no_ghost_sockets):  # noqa: F811
    sent = []
    monkeypatch.setattr(server.recording.outbox, "post", lambda c, m: sent.append((c, m)) or True)
    devices = {role: object() for role in ("local", "control", "guest", "eyes", "window")}
    for role, sock in devices.items():
        server.hub.clients[sock], server.hub.roles[sock] = "remote", role
    server.recording.tell()
    told = {role for role, sock in devices.items() if any(c is sock and '"rec"' in m for c, m in sent)}
    assert told == {"local", "control"}
    sent.clear()
    for sock in devices.values():
        server.recording.greet(sock)
    assert {role for role, sock in devices.items() if any(c is sock for c, m in sent)} == {"local", "control"}


# ---------- a real video: cut into pieces, handed in, joined – and an interrupted one stays playable ----------
needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg not installed")


def probe(path: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_entries",
                          "stream=codec_type,width,height,nb_read_frames:format=duration", "-of", "json", path],
                         capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
    return json.loads(out.stdout or "{}")


@needs_ffmpeg
@pytest.mark.parametrize("kind", ["webm", "mp4"])
def test_a_real_video_in_pieces_is_whole_and_an_interrupted_one_plays(server, rec, sandbox, tmp_path, monkeypatch, kind):
    src = tmp_path / f"src.{kind}"
    codec = ["-c:v", "libvpx", "-b:v", "1M"] if kind == "webm" else ["-c:v", "libx264", "-pix_fmt", "yuv420p",
                                                                     "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-g", "15"]
    made = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x320:rate=30:duration=3", *codec,
                           str(src)], capture_output=True, timeout=120, stdin=subprocess.DEVNULL)
    if made.returncode:
        pytest.skip(f"this ffmpeg cannot encode {kind}")
    monkeypatch.setattr(server.recording, "remux", REAL["remux"])      # the real tidying with ffmpeg
    data = src.read_bytes()
    c = client(server, "local")
    mime = "video/webm;codecs=vp8" if kind == "webm" else "video/mp4;codecs=avc1"
    for whole in (True, False):
        j = start(c, mime=mime, audio=False).json()
        cut = [data[i:i + len(data) // 7 + 1] for i in range(0, len(data), len(data) // 7 + 1)]
        for i, piece in enumerate(cut if whole else cut[:5]):
            assert chunk(c, j["id"], i, piece).json()["ok"]
        path = os.path.join(sandbox["DREAM_SAVE_DIR"], j["name"])
        if whole:
            c.post(f"/rec/end/{j['id']}")
            wait_until(lambda: not server.recording.tidying, 60)
            info = probe(path)
            v = info["streams"][0]
            assert (v["width"], v["height"]) == (320, 320) and int(v["nb_read_frames"]) == 90
        else:                                                          # the tab closed after five pieces
            server.recording.watch(time.monotonic() + server.recording.SILENT_SECS + 1)
            v = probe(path)["streams"][0]
            assert int(v["nb_read_frames"]) >= 30                      # what came until then plays
