"""Shared test setup (#186): every test runs in a sandbox – its own HOME and Dream folders in a temporary folder, a
stand-in for torch (no model, no GPU), no MIDI, no OSC port, no network, no launchd, no notifications. The real home folder, the real keys
and a running Dream are never touched."""
import os
import shutil
import stat
import sys
import tempfile
import types

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

FOLDERS = {"DREAM_STATE_DIR": "state", "DREAM_CONFIG_DIR": "config", "DREAM_SAVE_DIR": "saved"}
_session = {}
SERVER_ENV = ("DREAM_ROLE", "DREAM_LAN", "DREAM_CLOUD_CMD", "DREAM_OLLAMA", "DREAM_PORT", "DREAM_HTTPS_PORT", "DREAM_NOTIFY")


def _sandbox_env(base: str) -> dict:
    env = {"HOME": os.path.join(base, "home"), **{k: os.path.join(base, v) for k, v in FOLDERS.items()}}
    os.makedirs(env["HOME"], exist_ok=True)
    return env


def fake_torch() -> None:
    """Just enough of torch for render.py and styles.py to import: no CUDA, no MPS, nothing that computes."""
    torch = types.ModuleType("torch")
    torch.__dict__.update(
        cuda=types.SimpleNamespace(is_available=lambda: False),
        backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False)),
        float16="float16", float32="float32",
        no_grad=lambda: (lambda f: f))
    nn = types.ModuleType("torch.nn")
    functional = types.ModuleType("torch.nn.functional")
    nn.functional, torch.nn = functional, nn
    sys.modules.update({"torch": torch, "torch.nn": nn, "torch.nn.functional": functional})


def pytest_configure(config):
    """Before any test module is imported: the folders the modules read at import point into a fresh temporary folder."""
    base = tempfile.mkdtemp(prefix="dream-tests-")
    _session["base"], _session["env"] = base, {k: os.environ.get(k) for k in ("HOME", *FOLDERS, *SERVER_ENV)}
    os.environ.update(_sandbox_env(base))
    os.environ["DREAM_NOTIFY"] = "0"                    # #238: no test ever shows a notification of macOS
    for k in ("DREAM_PRELOAD", "DREAM_ENV"):
        os.environ.pop(k, None)
    fake_torch()


def pytest_unconfigure(config):
    for k, v in _session.get("env", {}).items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    if _session.get("base"):
        shutil.rmtree(_session["base"], ignore_errors=True)


@pytest.fixture(autouse=True)
def sandbox(tmp_path, monkeypatch):
    """Each test: its own HOME and Dream folders; the mapping files of midi, sensors, dance and playlists point there too."""
    env = _sandbox_env(str(tmp_path))
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import dance
    import danceprofiles
    import midi
    import playlists
    import sensors
    monkeypatch.setattr(dance, "MAP_FILE", os.path.join(env["DREAM_CONFIG_DIR"], "dance.json"))
    monkeypatch.setattr(danceprofiles, "FILE", os.path.join(env["DREAM_CONFIG_DIR"], "dance-profiles.json"))   # #266
    monkeypatch.setattr(midi, "MAP_FILE", os.path.join(env["DREAM_CONFIG_DIR"], "midi.json"))
    monkeypatch.setattr(sensors, "MAP_FILE", os.path.join(env["DREAM_CONFIG_DIR"], "sensors.json"))
    monkeypatch.setattr(playlists, "USER_FILE", os.path.join(env["DREAM_CONFIG_DIR"], "playlists.json"))
    return env


@pytest.fixture(scope="session")
def server():
    """server.py (and with it every part of the app: server.hub, server.rights, …) imported once, as the app with --lan, in
    the session sandbox: no MIDI thread, no cloud, no Ollama."""
    base = _session["base"]
    cloud = os.path.join(base, "fake-dream-cloud")
    with open(cloud, "w") as f:
        f.write("#!/bin/sh\nexit 0\n")
    os.chmod(cloud, os.stat(cloud).st_mode | stat.S_IXUSR)
    os.environ.update({"DREAM_ROLE": "app", "DREAM_LAN": "1", "DREAM_CLOUD_CMD": cloud,
                       "DREAM_OLLAMA": "http://127.0.0.1:9", "DREAM_PORT": "7860", "DREAM_HTTPS_PORT": "7443"})
    import midi
    start = midi.Listener.start
    midi.Listener.start = lambda self: None            # no MIDI ports opened
    try:
        import server as srv
    finally:
        midi.Listener.start = start
    assert srv.hub.STATE_DIR.startswith(base) and srv.media.SAVE_DIR.startswith(base)
    srv.net.lan_ip = lambda: "192.168.1.20"              # invented; no socket is opened
    srv.net.local_hostnames = lambda: ["dream-mac.local"]

    async def idle():
        return None
    for part, loop in ((srv.scenes, "scene_loop"), (srv.inputs, "midi_loop"), (srv.inputs, "sensor_loop"),
                       (srv.eyes, "aimask_loop"), (srv.eyes, "world_loop")):      # /ctl starts them: no OSC port, no timers
        srv.real_loops = {**getattr(srv, "real_loops", {}), loop: getattr(part, loop)}   # for a test of the loop itself
        setattr(part, loop, idle)
    return srv
