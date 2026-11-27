"""#277: firmware/flash.sh – finding the board by its USB ids, the arguments, the retry, the exit codes and installing
PlatformIO when it is missing. A fake `pio` (and a fake `uv`) stand in: it lists the serial ports a test gives it and
logs what it was asked to build and upload. No real device, no PlatformIO, no network."""
import json
import os
import shutil
import stat
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "firmware", "flash.sh")
STICK = {"port": "/dev/cu.usbmodem1101", "description": "USB JTAG/serial debug unit", "hwid": "USB VID:PID=303A:1001 SER=00:11 LOCATION=1-1"}
OTHER = {"port": "/dev/cu.usbserial-1", "description": "CP2104", "hwid": "USB VID:PID=10C4:EA60 SER=1"}
BLUE = {"port": "/dev/cu.Bluetooth-Incoming-Port", "description": "n/a", "hwid": "n/a"}

pytestmark = pytest.mark.skipif(not shutil.which("bash") or sys.platform.startswith("win"), reason="needs bash")

FAKE_PIO = """#!/bin/sh
echo "$*" >> "$FAKE_LOG"
if [ "$1" = device ]; then cat "$FAKE_PORTS"; exit 0; fi
if [ "$1" = run ]; then
  n=$(grep -c '^run ' "$FAKE_LOG")
  [ "$n" -gt "${FAKE_FAILS:-0}" ] && exit 0
  echo "upload error" >&2; exit 1
fi
exit 9
"""


def executable(path, text):
    with open(path, "w") as f:
        f.write(text)
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)


@pytest.fixture
def fake(tmp_path):
    executable(tmp_path / "pio", FAKE_PIO)
    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path / "home"), "PIO": str(tmp_path / "pio"), "RETRY_WAIT": "0",
           "FAKE_LOG": str(tmp_path / "log"), "FAKE_PORTS": str(tmp_path / "ports.json")}
    os.makedirs(env["HOME"], exist_ok=True)

    def run(*args, ports=(), fails=0, **more):
        with open(env["FAKE_PORTS"], "w") as f:
            json.dump(list(ports), f)
        if os.path.exists(env["FAKE_LOG"]):
            os.remove(env["FAKE_LOG"])
        e = {**env, "FAKE_FAILS": str(fails), **more}
        p = subprocess.run(["bash", SCRIPT, *args], env=e, capture_output=True, text=True, timeout=60)
        log = open(env["FAKE_LOG"]).read().splitlines() if os.path.exists(env["FAKE_LOG"]) else []
        return p.returncode, p.stdout + p.stderr, [line for line in log if line.startswith("run ")]
    run.tmp = tmp_path
    return run


def test_the_one_stick_plugged_in_is_found_and_flashed(fake):
    code, out, runs = fake("sticks3", ports=[BLUE, OTHER, STICK])
    assert code == 0 and "Done: M5Stack StickS3 (ESP32-S3) on /dev/cu.usbmodem1101" in out
    assert runs == [f"run -d {os.path.join(ROOT, 'firmware', 'sticks3')} -t upload --upload-port /dev/cu.usbmodem1101"]


def test_none_or_several_is_a_clear_error_and_nothing_is_flashed(fake):
    code, out, runs = fake("sticks3", ports=[BLUE, OTHER])
    assert (code, runs) == (3, []) and "no M5Stack StickS3 (ESP32-S3) found by USB" in out
    twin = {**STICK, "port": "/dev/cu.usbmodem2201"}
    code, out, runs = fake("sticks3", ports=[STICK, twin])
    assert (code, runs) == (4, []) and "/dev/cu.usbmodem1101 /dev/cu.usbmodem2201" in out and "--port" in out


def test_a_port_given_is_taken_as_it_is(fake):
    code, out, runs = fake("sticks3", "--port", "/dev/cu.usbmodem9", ports=[])
    assert code == 0 and runs[0].endswith("--upload-port /dev/cu.usbmodem9")
    code, out, runs = fake("--port=/dev/cu.x", "sticks3", ports=[STICK, STICK])
    assert code == 0 and runs[0].endswith("--upload-port /dev/cu.x")


def test_a_failed_upload_is_tried_once_more(fake):
    code, out, runs = fake("sticks3", ports=[STICK], fails=1)
    assert code == 0 and len(runs) == 2 and "trying once more" in out
    code, out, runs = fake("sticks3", ports=[STICK], fails=5)
    assert code == 1 and len(runs) == 2 and "failed twice" in out


def test_the_list_shows_only_boards_of_dream(fake):
    code, out, runs = fake("--list", ports=[BLUE, OTHER, STICK, {"port": "", "hwid": "x"}, "nonsense"])
    assert code == 0 and runs == []
    assert out.splitlines() == ["sticks3\t/dev/cu.usbmodem1101\tM5Stack StickS3 (ESP32-S3) [303A:1001]"]
    code, out, _ = fake("--list", ports=[OTHER])
    assert code == 0 and "No board of Dream's found" in out


@pytest.mark.parametrize("args", [[], ["nothing"], ["sticks3", "sticks3"], ["sticks3", "--port"], ["--port="],
                                  ["sticks3", "--frobnicate"], ["lib"]])
def test_a_wrong_call_says_how_and_flashes_nothing(fake, args):
    code, out, runs = fake(*args, ports=[STICK])
    assert (code, runs) == (2, []) and "Usage:" in out


def test_help(fake):
    code, out, runs = fake("--help")
    assert code == 0 and "Usage:" in out and runs == []


def test_platformio_is_installed_with_uv_when_it_is_missing(fake):
    tmp = fake.tmp
    bin_ = tmp / "uvbin"
    os.makedirs(bin_)
    executable(tmp / "uv", f"""#!/bin/sh
echo "uv $*" >> "{tmp / 'uvlog'}"
[ "$1 $2 $3" = "tool install platformio" ] && cp "{tmp / 'pio'}" "{bin_}/pio" && exit 0
[ "$1 $2 $3" = "tool dir --bin" ] && echo "{bin_}" && exit 0
exit 1
""")
    code, out, runs = fake("sticks3", ports=[STICK], PIO="", UV=str(tmp / "uv"))
    assert code == 0 and "Installing PlatformIO" in out and len(runs) == 1
    assert open(tmp / "uvlog").read().splitlines()[0] == "uv tool install platformio"
    code, out, runs = fake("sticks3", ports=[STICK], PIO="", UV="/nonexistent/uv")
    assert code == 5 and runs == []
