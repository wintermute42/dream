"""#203: dream-window-prep turns an Android device into a dream window – run against a stand-in adb and curl."""
import json
import os
import stat
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEY = "secret-window-key-123"

FAKE_ADB = r'''#!/bin/bash
echo "$*" >> "$LOG"
case "$*" in
  devices) printf 'List of devices attached\nTEST1\tdevice\n\n' ;;
  *"getprop ro.product.model"*) echo "Test Phone" ;;
  *"getprop ro.build.version.sdk"*) echo 30 ;;
  *"wm size"*) echo "Physical size: 1080x2280" ;;
  *"pm get-max-users"*) echo "maxSupportedUsers: $MAXUSERS" ;;
  *"pm list users"*) echo "Users:"; echo "	UserInfo{0:Owner:c13} running" ;;
  *"pm create-user"*) echo "Success: created user id 11" ;;
esac
exit 0
'''


def run(tmp_path, *args, window=f"http://192.168.1.20:7860/window?k={KEY}", maxusers=1):
    bin_ = tmp_path / "bin"
    bin_.mkdir(exist_ok=True)
    for name, body in (("adb", FAKE_ADB),
                       ("curl", "#!/bin/sh\n" + (f"echo '{json.dumps({'window': window})}'\n" if window else "exit 7\n"))):
        f = bin_ / name
        f.write_text(body)
        f.chmod(f.stat().st_mode | stat.S_IXUSR)
    log = tmp_path / "adb.log"
    env = {**os.environ, "PATH": f"{bin_}:{os.environ['PATH']}", "LOG": str(log), "MAXUSERS": str(maxusers),
           "DREAM_PREP_WAIT": "0", "DREAM_PORT": "7860", "HOME": str(tmp_path)}
    r = subprocess.run([str(ROOT / "dream-window-prep"), *args], env=env, capture_output=True, text=True, timeout=30)
    return r, (log.read_text() if log.exists() else "")


def test_sets_up_the_device_and_opens_the_window(tmp_path):
    r, log = run(tmp_path)
    assert r.returncode == 0, r.stderr
    assert "settings put global stay_on_while_plugged_in 7" in log      # the screen stays on while charging
    assert "cmd notification set_dnd priority" in log
    assert "settings put global low_power 0" in log
    assert "deviceidle whitelist +com.android.chrome" in log
    assert f"/window?k={KEY}" in log                                    # the window opened with its key
    assert "input tap 540 1140" in log                                  # one tap: fullscreen
    assert "Still by hand" in r.stdout


def test_the_key_never_shows_in_the_output(tmp_path):
    r, _ = run(tmp_path)
    assert KEY not in r.stdout and KEY not in r.stderr
    assert "http://192.168.1.20:7860/window" in r.stdout


def test_without_dream_nothing_happens(tmp_path):
    r, log = run(tmp_path, window=None)
    assert r.returncode == 1 and "--lan" in r.stderr
    assert "stay_on_while_plugged_in" not in log


def test_an_address_that_is_not_a_window_is_refused(tmp_path):
    r, log = run(tmp_path, window="http://evil.example/x")
    assert r.returncode == 1 and "am start" not in log


def test_a_user_of_its_own_where_the_device_allows_it(tmp_path):
    r, log = run(tmp_path, "--user", maxusers=4)
    assert "pm create-user Dream" in log and "am switch-user 11" in log
    assert "settings --user 11 put system screen_off_timeout" in log
    assert "PIN" in r.stdout


def test_one_user_only_goes_on_with_the_current_one(tmp_path):
    r, log = run(tmp_path, "--user", maxusers=1)
    assert "pm create-user" not in log and "only one user" in r.stdout
    assert "stay_on_while_plugged_in 7" in log


def test_undo_puts_it_back(tmp_path):
    r, log = run(tmp_path, "--undo", window=None)                       # needs no Dream
    assert r.returncode == 0
    assert "stay_on_while_plugged_in 0" in log and "set_dnd off" in log and "am start" not in log
