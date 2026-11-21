"""Configurable folders (#186): DREAM_STATE_DIR, DREAM_CONFIG_DIR and DREAM_SAVE_DIR, read in paths.py; without them
everything stays where it always was. Imports of server.py run in a child process with its own HOME."""
import json
import os
import re
import stat
import subprocess
import sys

import pytest

import paths

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VARS = ("DREAM_STATE_DIR", "DREAM_CONFIG_DIR", "DREAM_SAVE_DIR", "DREAM_ENV", "DREAM_LAN", "DREAM_PRELOAD")
IMPORT = """
import json, os, sys
sys.path[:0] = [{root!r}, {tests!r}]
import conftest
conftest.fake_torch()
import midi
midi.Listener.start = lambda self: None
import playlists, sensors, server
print(json.dumps({{"state_dir": server.hub.STATE_DIR, "save_dir": server.media.SAVE_DIR, "midi": midi.MAP_FILE,
                  "sensors": sensors.MAP_FILE, "playlists": playlists.USER_FILE, "state": server.hub.state}}))
"""


def child_env(home: str, **extra) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in VARS}
    env.update(HOME=home, **extra)
    return env


def import_server(home: str, **extra) -> dict:
    code = IMPORT.format(root=ROOT, tests=os.path.join(ROOT, "tests"))
    out = subprocess.run([sys.executable, "-c", code], env=child_env(home, **extra), cwd=home, capture_output=True,
                         text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_defaults(monkeypatch, tmp_path):
    home = str(tmp_path / "home")
    monkeypatch.setenv("HOME", home)
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    assert paths.state_dir() == os.path.join(home, ".local", "state", "dream")
    assert paths.config_dir() == os.path.join(home, ".config", "dream")
    assert paths.save_dir() == os.path.join(home, "Pictures", "Dream")
    monkeypatch.setenv("DREAM_STATE_DIR", "")                     # empty is the default, as ${VAR:-…} in the scripts
    assert paths.state_dir() == os.path.join(home, ".local", "state", "dream")


def test_variables(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("DREAM_STATE_DIR", "/srv/dream/state")
    monkeypatch.setenv("DREAM_CONFIG_DIR", "~/dream-config")
    monkeypatch.setenv("DREAM_SAVE_DIR", "/srv/dream/saved")
    assert paths.state_dir() == "/srv/dream/state"
    assert paths.config_dir() == str(tmp_path / "dream-config")
    assert paths.save_dir() == "/srv/dream/saved"


def test_shown(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    assert paths.shown(str(tmp_path / "Pictures" / "Dream" / "a.jpg")) == "~/Pictures/Dream/a.jpg"
    assert paths.shown("/srv/dream/saved/a.jpg") == "/srv/dream/saved/a.jpg"
    assert paths.shown(str(tmp_path) + "-other/a.jpg") == str(tmp_path) + "-other/a.jpg"


def test_server_without_variables_uses_the_old_folders(tmp_path):
    home = str(tmp_path / "home")
    os.makedirs(home, exist_ok=True)
    got = import_server(home)
    state = os.path.join(home, ".local", "state", "dream")
    config = os.path.join(home, ".config", "dream")
    assert got["state_dir"] == state
    assert got["save_dir"] == os.path.join(home, "Pictures", "Dream")
    assert (got["midi"], got["sensors"], got["playlists"]) == tuple(
        os.path.join(config, n) for n in ("midi.json", "sensors.json", "playlists.json"))
    assert stat.S_IMODE(os.stat(state).st_mode) == 0o700
    for name in ("remote-token", "control-token", "eyes-token"):
        assert stat.S_IMODE(os.stat(os.path.join(state, name)).st_mode) == 0o600


def test_server_with_variables_stays_out_of_home(tmp_path):
    home = str(tmp_path / "home")
    os.makedirs(home, exist_ok=True)
    folders = {v: str(tmp_path / v.lower()) for v in ("DREAM_STATE_DIR", "DREAM_CONFIG_DIR", "DREAM_SAVE_DIR")}
    got = import_server(home, **folders)
    assert got["state_dir"] == folders["DREAM_STATE_DIR"]
    assert got["save_dir"] == folders["DREAM_SAVE_DIR"]
    assert got["midi"] == os.path.join(folders["DREAM_CONFIG_DIR"], "midi.json")
    assert os.path.exists(os.path.join(folders["DREAM_STATE_DIR"], "control-token"))
    assert os.listdir(home) == []


def test_poisoned_state_file_heals(tmp_path):
    """#175: a saved NaN, Inf or a number out of range never comes back."""
    home, state = str(tmp_path / "home"), tmp_path / "state"
    os.makedirs(home, exist_ok=True)
    state.mkdir()
    (state / "state.json").write_text('{"strength": NaN, "zoom": Infinity, "hue": 1e999, "seed": 99999999999999, '
                                      '"quality": "3", "mix": 0.2, "unknown": 1}')
    got = import_server(home, DREAM_STATE_DIR=str(state))["state"]
    assert (got["strength"], got["zoom"], got["hue"]) == (0.45, 0.008, 2.0)
    assert (got["seed"], got["quality"], got["mix"]) == (2 ** 31 - 1, 3, 0.2)
    assert "unknown" not in got


# ---------- the shell scripts honour the same variables ----------
def test_dream_cloud_state_dir(tmp_path):
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)

    def run(**extra):
        r = subprocess.run([os.path.join(ROOT, "dream-cloud"), "--help"], env=child_env(str(home), **extra),
                           capture_output=True, text=True, timeout=60)
        assert r.returncode == 0, r.stderr

    run()
    assert (home / ".local" / "state" / "dream").is_dir()
    run(DREAM_STATE_DIR=str(tmp_path / "from-env"))
    assert (tmp_path / "from-env").is_dir()
    config = tmp_path / "config"
    config.mkdir()
    (config / "dream.env").write_text(f"DREAM_STATE_DIR={tmp_path / 'from-file'}\n")
    run(DREAM_CONFIG_DIR=str(config), DREAM_STATE_DIR=str(tmp_path / "loses"))   # dream.env wins, as in dream.sh
    assert (tmp_path / "from-file").is_dir() and not (tmp_path / "loses").exists()


def autostart_setting(tmp_path, name: str, default: str, dream_env: str | None = None, **extra) -> str:
    """The `setting` helper of install-autostart.sh, run on its own (the script itself would talk to launchd)."""
    src = open(os.path.join(ROOT, "install-autostart.sh"), encoding="utf-8").read()
    lines = [ln for ln in src.splitlines() if ln.startswith(("ENV_FILE=", "setting() "))]
    assert len(lines) == 2
    home = tmp_path / "home"
    (home / ".config" / "dream").mkdir(parents=True, exist_ok=True)
    if dream_env is not None:
        (home / ".config" / "dream" / "dream.env").write_text(dream_env)
    script = "set -euo pipefail\n" + "\n".join(lines) + f'\nsetting {name} "{default}"\n'
    r = subprocess.run(["bash", "-c", script], env=child_env(str(home), **extra), capture_output=True, text=True,
                       timeout=30)
    assert r.returncode == 0, r.stderr
    return r.stdout


def test_autostart_port_and_state(tmp_path):
    assert autostart_setting(tmp_path, "DREAM_PORT", "7860") == "7860"
    assert autostart_setting(tmp_path, "DREAM_PORT", "7860", "DREAM_PORT=7999\n") == "7999"
    assert autostart_setting(tmp_path, "DREAM_PORT", "7860", "# nothing\n", DREAM_PORT="7123") == "7123"
    assert autostart_setting(tmp_path, "DREAM_STATE_DIR", "/default", "DREAM_STATE_DIR=/srv/dream\n") == "/srv/dream"


def test_autostart_has_no_fixed_port():
    src = open(os.path.join(ROOT, "install-autostart.sh"), encoding="utf-8").read()
    assert "7860" not in src.replace('setting DREAM_PORT 7860', '').replace('PORT=7860 ;;', '')


# ---------- one place ----------
DEFAULTS = (".local/state/dream", ".config/dream", "Pictures/Dream")


def test_python_reads_the_folders_only_in_paths_py():
    for name in sorted(os.listdir(ROOT)):
        if not name.endswith(".py") or name == "paths.py":
            continue
        for ln, line in enumerate(open(os.path.join(ROOT, name), encoding="utf-8"), 1):
            code = line.split("#", 1)[0]
            assert not re.search(r"expanduser\([^)]*(" + "|".join(map(re.escape, DEFAULTS)) + ")", code), f"{name}:{ln}"


@pytest.mark.parametrize("script", ["dream.sh", "dream-cloud", "install-autostart.sh"])
def test_shell_scripts_use_the_variables(script):
    var = {".local/state/dream": "DREAM_STATE_DIR", ".config/dream": "DREAM_CONFIG_DIR", "Pictures/Dream": "DREAM_SAVE_DIR"}
    for ln, line in enumerate(open(os.path.join(ROOT, script), encoding="utf-8"), 1):
        if line.lstrip().startswith("#"):
            continue
        for m in re.finditer(r"\$HOME/(\.local/state/dream|\.config/dream|Pictures/Dream)", line):
            before = line[:m.start()]
            assert before.endswith(("${" + var[m.group(1)] + ":-", f'setting {var[m.group(1)]} "')), f"{script}:{ln}"


def test_worker_loads_only_the_renderer(tmp_path):
    """#189: the cloud worker is the renderer and its lines – no keys, no state folder, none of the app's parts."""
    home = str(tmp_path / "home")
    os.makedirs(home, exist_ok=True)
    code = f"""
import json, os, sys
sys.path[:0] = [{ROOT!r}, {os.path.join(ROOT, "tests")!r}]
import conftest
conftest.fake_torch()
import server
app_parts = sorted(m for m in ("rights", "settings", "hub", "ctl", "cloud", "media", "eyes", "net", "pages") if m in sys.modules)
print(json.dumps({{"routes": sorted(r.path for r in server.app.routes), "app_parts": app_parts,
                  "state": os.path.exists(os.path.join({home!r}, ".local", "state", "dream"))}}))
"""
    out = subprocess.run([sys.executable, "-c", code], env=child_env(home, DREAM_ROLE="worker"), cwd=home,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout.strip().splitlines()[-1])
    assert got["app_parts"] == [] and got["state"] is False
    assert {"/ws", "/make", "/health", "/stats"} <= set(got["routes"])
    assert not {"/ctl", "/", "/remote", "/static", "/cloud/start"} & set(got["routes"])
