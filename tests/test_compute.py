"""#238: who computes right now. The renderer says itself where it stands (loading, downloading, compiling, ready),
dream-cloud passes that on, the server makes one step of it for the pages and tells the owner when the cloud GPU is
ready. No GPU, no cloud, no notification: the states are made up here. (What the pages make of a step:
tests/js/compute.test.mjs.)"""
import asyncio
import json
import os
import re
import stat
import subprocess
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
RUNNING = {"state": "running", "provider": "runpod", "type": "runpod:RTX-4090", "minutes": 3, "cost_eur": 0.04,
           "currency": "USD", "tunnel": True, "busy": False}


@pytest.fixture
def cloud(server, monkeypatch):
    """cloud.py with nothing remembered from an earlier status and no start or stop under way."""
    monkeypatch.setattr(server.cloud, "_work", {"phase": None, "since": 0.0, "misses": 0, "unread": None})
    monkeypatch.setattr(server.cloud, "_job", {**server.cloud._job, "proc": None, "action": ""})
    return server.cloud


@pytest.fixture
def render(server, monkeypatch):
    """render.py as it is before any model: nothing loaded, nothing loading, nothing compiled."""
    r = server.render
    monkeypatch.setattr(r, "model_state", {"active": None, "loading": None, "error": None, "error_key": None, "error_at": 0.0, "first": False})
    monkeypatch.setattr(r, "_pipes", {})
    monkeypatch.setattr(r, "_compiled", set())
    monkeypatch.setattr(r, "compile_state", {"since": None, "cached": False})
    monkeypatch.setattr(r, "_busy", {"t": 0.0, "n": 0, "key": None, "since": None})
    monkeypatch.setattr(r, "downloaded_gb", lambda repo, cache=None: None)
    return r


# ---------- the renderer says where it stands ----------

def test_a_renderer_without_a_model_is_ready_to_load_one(render):
    assert render.progress() == {"model": None, "loading": None, "model_error": None, "first_download": False,
                                 "compiling": False, "failed": False, "ready": True}


def test_the_first_download_is_told_with_what_has_arrived(render, monkeypatch):
    render.model_state.update(loading="sdxl-turbo", first=True)
    monkeypatch.setattr(render, "downloaded_gb", lambda repo, cache=None: 2.8 if repo == "stabilityai/sdxl-turbo" else None)
    p = render.progress()
    assert (p["loading"], p["first_download"], p["download_gb"], p["ready"]) == ("sdxl-turbo", True, 2.8, False)


def test_loading_without_a_download_tells_no_size(render):
    render.model_state.update(loading="sd-turbo")
    p = render.progress()
    assert p["ready"] is False and p["first_download"] is False and "download_gb" not in p


def test_the_model_in_use_paints_on_while_another_one_loads(render):
    render._pipes["sd-turbo"] = object()
    render.model_state.update(active="sd-turbo", loading="sdxl-turbo")
    assert render.progress()["ready"] is True


def test_the_compile_before_the_first_picture_is_told_with_its_time(render):
    render.model_state.update(loading="sd-turbo")
    render.compile_state.update(since=1000.0, cached=True)
    p = render.progress(now=1042.5)
    assert (p["compiling"], p["compiling_s"], p["compile_cached"], p["ready"]) == (True, 42, True, False)


def test_a_compiled_model_whose_picture_takes_long_is_compiling_again(render):
    render._pipes["sdxl-turbo"] = object()
    render.model_state.update(active="sdxl-turbo")
    render._compiled.add("sdxl-turbo")
    render._busy.update(key="sdxl-turbo", since=1000.0)
    assert render.progress(now=1001.0)["compiling"] is False           # a picture in work: nothing to tell
    p = render.progress(now=1000.0 + render.RECOMPILE_AFTER + 60)
    assert (p["compiling"], p["compiling_s"], p["compile_cached"], p["ready"]) == (True, 63, False, False)
    render._busy.update(key=None, since=None)                           # the picture is through
    assert render.progress(now=1100.0)["ready"] is True


def test_a_model_that_is_not_compiled_never_says_compiling(render):
    """The Mac: a slow picture (SDXL-Turbo takes seconds there) is just a slow picture."""
    render._pipes["sdxl-turbo"] = object()
    render.model_state.update(active="sdxl-turbo")
    render._busy.update(key="sdxl-turbo", since=1000.0)
    p = render.progress(now=1090.0)
    assert p["compiling"] is False and p["ready"] is True


def test_a_failed_load_with_nothing_to_paint_with_is_not_ready(render):
    render.model_state.update(error="OSError: no network", error_key="sd-turbo")
    p = render.progress()
    assert p["failed"] is True and p["ready"] is False
    render._pipes["sdxl-turbo"] = object()                              # another model is there: it paints
    assert render.progress()["failed"] is False


def test_what_has_arrived_counts_unfinished_files_too(server, tmp_path):
    blobs = tmp_path / "models--stabilityai--sdxl-turbo" / "blobs"
    blobs.mkdir(parents=True)
    (blobs / "aaa").write_bytes(b"x" * 30_000_000)
    (blobs / "bbb.incomplete").write_bytes(b"x" * 20_000_000)
    assert server.render.downloaded_gb("stabilityai/sdxl-turbo", str(tmp_path)) == 0.05
    assert server.render.downloaded_gb("stabilityai/sd-turbo", str(tmp_path)) is None      # nothing there: not known


def test_the_preload_runs_beside_the_server_and_says_so(render, monkeypatch):
    go, loaded = threading.Event(), threading.Event()

    def pipeline(key):
        go.wait(5)
        render._pipes[key] = object()
        loaded.set()

    monkeypatch.setattr(render, "pipeline", pipeline)
    monkeypatch.setattr(render, "_in_cache", lambda repo: False)
    render.preload(["sdxl-turbo"])                                      # returns at once: the server answers meanwhile
    assert render.model_state["loading"] == "sdxl-turbo" and render.progress()["ready"] is False
    go.set()
    assert loaded.wait(5)
    for _ in range(100):
        if render.model_state["loading"] is None:
            break
        threading.Event().wait(0.02)
    p = render.progress()
    assert (p["loading"], p["first_download"], p["ready"]) == (None, False, True)


def test_a_preload_that_fails_is_told(render, monkeypatch):
    done = threading.Event()

    def pipeline(key):
        done.set()
        raise OSError("no network")

    monkeypatch.setattr(render, "pipeline", pipeline)
    monkeypatch.setattr(render, "_in_cache", lambda repo: True)
    render.preload(["sd-turbo"])
    assert done.wait(5)
    for _ in range(100):
        if render.model_state["loading"] is None:
            break
        threading.Event().wait(0.02)
    p = render.progress()
    assert p["failed"] is True and p["ready"] is False and "no network" in p["model_error"]


def test_health_and_stats_carry_it(render, server):
    render.model_state.update(loading="sd-turbo", error="OSError: /somewhere/private")
    render.compile_state.update(since=1.0)
    health, stats = server.render_api.health(), server.render_api.stats()
    assert health["compiling"] is True and health["ready"] is False and health["loading"] == "sd-turbo"
    assert "model_error" not in health                                  # on the Mac a guest may ask /health
    assert stats["compiling"] is True and stats["model_error"].startswith("OSError") and "ai_fps" in stats


# ---------- dream-cloud passes it on ----------

def _functions(*names) -> str:
    script = (ROOT / "dream-cloud").read_text(encoding="utf-8")
    return "\n".join(re.search(rf"^{n}\(\) \{{.*?^\}}$|^{n}\(\) \{{.*\}}$", script, re.M | re.S).group(0) for n in names)


@pytest.mark.parametrize("health, word", [
    ('{"role":"worker","models":["sd-turbo"]}', "ready"),               # a renderer of an earlier version
    ('{"ready":true,"compiling":false}', "ready"),
    ('{"ready":false,"loading":"sdxl-turbo","first_download":true,"download_gb":1.2}', "download"),
    ('{"ready":false,"loading":"sdxl-turbo","first_download":false}', "loading"),
    ('{"ready":false,"compiling":true,"compiling_s":12}', "compiling"),
    ('{"ready":false,"failed":true}', "failed"),
    ("", ""), ("<html>502</html>", ""),
])
def test_dream_cloud_makes_one_word_of_the_renderers_answer(tmp_path, health, word):
    curl = tmp_path / "curl"                                            # no network: the renderer's answer is made up
    curl.write_text("#!/bin/sh\n" + (f"cat <<'EOF'\n{health}\nEOF\n" if health else "exit 7\n"))
    curl.chmod(curl.stat().st_mode | stat.S_IXUSR)
    script = f"set -euo pipefail\nLOCAL_PORT=1\n{_functions('worker_json', 'step_of', 'ready')}\n" \
             'w="$(worker_json)"; printf "%s|%s|" "$(step_of "$w")" "$w"; ready && echo yes || echo no\n'
    r = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30,
                       env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"})
    assert r.returncode == 0, r.stderr
    got, passed, is_ready = r.stdout.strip().split("|")
    assert got == word and is_ready == ("yes" if word == "ready" else "no")
    assert (json.loads(passed) == json.loads(health)) if word else passed == ""


def test_dream_cloud_shows_no_line_of_the_machines_log():
    script = (ROOT / "dream-cloud").read_text(encoding="utf-8")
    start = script[script.index("cmd_start() {"):script.index("cmd_stop() {")]
    assert "tail -n1 /var/log/dream.log" not in start
    assert '"worker":%s' in script


# ---------- the server makes a step of it ----------

@pytest.mark.parametrize("status, action, phase", [
    ({"state": "setup"}, "", None),
    ({"state": "off", "busy": False}, "", None),
    ({"state": "off", "busy": True}, "start", "machine"),
    ({**RUNNING, "busy": True, "worker": None}, "start", "machine"),
    ({**RUNNING, "busy": True, "worker": {"ready": False, "loading": "sdxl-turbo", "first_download": True}}, "start", "download"),
    ({**RUNNING, "busy": True, "worker": {"ready": False, "loading": "sdxl-turbo", "first_download": False}}, "start", "loading"),
    ({**RUNNING, "busy": True, "worker": {"ready": False, "loading": "sdxl-turbo", "compiling": True}}, "start", "compiling"),
    ({**RUNNING, "worker": {"ready": True, "compiling": False}}, "start", "ready"),
    ({**RUNNING, "worker": {"ready": False, "compiling": True, "model": "sdxl-turbo"}}, "start", "compiling"),   # a new size, later
    ({**RUNNING, "worker": {"ready": False, "failed": True}}, "start", "unreachable"),
    ({**RUNNING, "worker": None}, "start", "unreachable"),
    ({**RUNNING, "ready": True, "worker": {"role": "worker", "models": ["sd-turbo"]}}, "start", "ready"),      # an earlier renderer
    ({**RUNNING, "ready": True}, "start", "ready"),                                                              # an earlier dream-cloud
    ({**RUNNING, "busy": True, "worker": {"ready": True}}, "stop", "stopping"),
])
def test_the_step_of_a_status(cloud, status, action, phase):
    cloud._job["action"] = action
    assert cloud.work_phase(status) == phase


def test_a_start_counts_down_roughly(cloud):
    cloud._job["action"] = "start"
    starting = {"state": "off", "busy": True}
    assert cloud.cloud_work(starting, now=1000.0) == {"phase": "machine", "eta_min": 8}
    assert cloud.cloud_work(starting, now=1000.0 + 5 * 60)["eta_min"] == 3
    assert cloud.cloud_work(starting, now=1000.0 + 30 * 60)["eta_min"] == 1      # late: never zero, never negative


def test_a_download_tells_how_far_it_is(cloud):
    w = {"ready": False, "loading": "sdxl-turbo", "first_download": True, "download_gb": 3.5}
    work = cloud.cloud_work({**RUNNING, "busy": True, "worker": w}, now=1000.0)
    assert work == {"phase": "download", "percent": 50, "eta_min": 5, "model": "sdxl-turbo"}
    full = cloud.cloud_work({**RUNNING, "busy": True, "worker": {**w, "download_gb": 9.0}}, now=1010.0)
    assert full["percent"] == 99 and full["eta_min"] == 3
    unknown = cloud.cloud_work({**RUNNING, "busy": True, "worker": {**w, "download_gb": None}}, now=1020.0)
    assert "percent" not in unknown and unknown["eta_min"] == 5


def test_compiling_is_shorter_with_the_cache(cloud):
    def left(**w):
        return cloud.cloud_work({**RUNNING, "worker": {"ready": False, "compiling": True, **w}}, now=1000.0)["eta_min"]
    assert left(compiling_s=0, compile_cached=True) == 2
    assert left(compiling_s=0, compile_cached=False) == 5
    assert left(compiling_s=150, compile_cached=False) == 3
    assert left(compiling_s=900) == 1


def test_one_question_without_an_answer_is_not_an_outage(cloud):
    ready, silent = {**RUNNING, "worker": {"ready": True}}, {**RUNNING, "worker": None}
    assert cloud.cloud_work(ready, now=1000.0)["phase"] == "ready"
    assert cloud.cloud_work(silent, now=1003.0)["phase"] == "ready"
    assert cloud.cloud_work(silent, now=1006.0)["phase"] == "unreachable"
    assert cloud.cloud_work(ready, now=1009.0)["phase"] == "ready"
    assert cloud.cloud_work(silent, now=1012.0)["phase"] == "ready"      # counted anew


def test_a_status_that_cannot_be_read_keeps_the_step_for_a_while(cloud):
    assert cloud.cloud_work({**RUNNING, "worker": {"ready": True}}, now=1000.0)["phase"] == "ready"
    unread = {"state": "error", "error": "timeout", "busy": False}
    assert cloud.cloud_work(unread, now=1010.0) == {"phase": "ready"}
    assert cloud.cloud_work(unread, now=1010.0 + cloud.UNREADABLE_S) is None
    assert cloud.cloud_work({"state": "error", "busy": False}, now=2000.0) is None


def test_the_status_for_the_pages_carries_the_step(cloud, server, tmp_path, monkeypatch):
    fake = tmp_path / "dream-cloud"
    status = {**RUNNING, "ready": False, "worker": {"ready": False, "compiling": True, "compiling_s": 30, "compile_cached": True}}
    del status["busy"]
    fake.write_text("#!/bin/sh\ncat <<'EOF'\n" + json.dumps(status) + "\nEOF\n")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setattr(server.config, "CLOUD", str(fake))
    monkeypatch.setitem(cloud._job, "log", str(tmp_path / "none.log"))
    st = cloud.cloud_read()
    assert st["work"] == {"phase": "compiling", "eta_min": 1} and st["busy"] is False and st["minutes"] == 3


# ---------- the owner hears when the cloud GPU is ready ----------

def test_no_test_shows_a_notification(server):
    assert server.config.NOTIFY is False


@pytest.mark.parametrize("before, phase, backend, says", [
    ("compiling", "ready", "cloud", "The cloud GPU is ready – Dream computes on it now."),
    ("download", "ready", "local", "The cloud GPU is ready – switch to it under “Computing”."),
    ("unreachable", "ready", "cloud", "The cloud GPU is ready – Dream computes on it now."),
    ("ready", "ready", "cloud", None),
    (None, "ready", "cloud", None),                    # Dream was started while a cloud GPU ran: nothing new
    ("machine", "download", "cloud", None),
    ("ready", "compiling", "cloud", None),
])
def test_ready_is_told_once_when_it_becomes_true(cloud, server, monkeypatch, before, phase, backend, says):
    monkeypatch.setitem(server.hub.state, "backend", backend)
    monkeypatch.setitem(cloud.i18n.fallback, "lang", "en")
    assert cloud.ready_note(before, phase) == says


def test_the_watcher_notifies_when_the_cloud_becomes_ready(cloud, server, monkeypatch):
    statuses = [{**RUNNING, "busy": True, "worker": {"ready": False, "loading": "sd-turbo"}},
                {**RUNNING, "worker": {"ready": True}}, {**RUNNING, "worker": {"ready": True}}]
    told = []

    def read():
        if not statuses:
            raise asyncio.CancelledError
        st = statuses.pop(0)
        work = cloud.cloud_work(st)
        cloud.cloud_cache["kick"] = True               # the watcher asks again at once
        return {**st, **({"work": work} if work else {})}

    cloud._job["action"] = "start"
    monkeypatch.setattr(cloud, "cloud_read", read)
    monkeypatch.setattr(cloud, "mac_notify", told.append)
    monkeypatch.setattr(cloud, "cloud_cache", {"st": None, "kick": False})
    monkeypatch.setitem(server.hub.state, "backend", "cloud")
    monkeypatch.setitem(cloud.i18n.fallback, "lang", "en")

    async def watch():
        with pytest.raises(asyncio.CancelledError):
            await cloud.cloud_watch()
        await asyncio.sleep(0.05)                      # the notification leaves in a thread of its own

    asyncio.run(watch())
    assert told == ["The cloud GPU is ready – Dream computes on it now."]


def test_a_notification_is_an_argument_never_script(cloud, server, monkeypatch):
    ran = []
    monkeypatch.setattr(cloud.subprocess, "run", lambda cmd, **kw: ran.append(cmd))
    cloud.mac_notify("ready")                          # as in every test: switched off
    assert ran == []
    monkeypatch.setattr(server.config, "NOTIFY", True)
    monkeypatch.setattr(cloud.sys, "platform", "linux")
    cloud.mac_notify("ready")                          # not a Mac: none
    assert ran == []
    monkeypatch.setattr(cloud.sys, "platform", "darwin")
    cloud.mac_notify('ready" & do shell script "x')
    assert len(ran) == 1 and ran[0][0] == "osascript" and ran[0][-1] == 'ready" & do shell script "x'
    assert not any("do shell script" in part for part in ran[0][:-1])


# ---------- the bridge switch ----------

def test_bridging_is_on_unless_switched_off_and_not_a_guests(server):
    assert server.settings.DEFAULT_STATE["cloud_bridge"] is True
    assert "cloud_bridge" not in server.settings.GUEST_KEYS
    assert server.settings.guest_changes({"cloud_bridge": False}) == {}
