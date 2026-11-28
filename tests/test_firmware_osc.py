"""#277: the firmware's own OSC (firmware/lib/DreamWear/src/DreamOsc.h) and Dream's (python-osc, wearables.py) are the
same language: the header is compiled for this computer with a small program that writes the devices' messages and
reads Dream's answers – checked here in both directions. Skipped without a C++ compiler; nothing touches a device."""
import os
import shutil
import subprocess

import pytest
from pythonosc.osc_message import OscMessage

import wearables

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEADER = os.path.join(ROOT, "firmware", "lib", "DreamWear", "src")
CXX = shutil.which("c++") or shutil.which("g++") or shutil.which("clang++")

PROGRAM = r"""
#include <stdio.h>
#include <string.h>
#include "DreamOsc.h"
using namespace dream_osc;
static void hex(const uint8_t* b, size_t n) { for (size_t k = 0; k < n; k++) printf("%02x", b[k]); printf("\n"); }
static int unhex(const char* s, uint8_t* out) { int n = 0; for (; s[0] && s[1]; s += 2) { unsigned v; sscanf(s, "%2x", &v); out[n++] = v; } return n; }
int main(int argc, char** argv) {
  uint8_t buf[128];
  Writer w(buf, sizeof buf);
  size_t n;
  n = w.build("/dream/wear/hello", "sssis", "a1b2c3d4e5f6", "sticks3", "", (int32_t)-1, "1.0.0"); hex(buf, n);
  n = w.build("/dream/wear/imu", "siffffff", "a1b2c3d4e5f6", (int32_t)123456, 0.5, -1.0, 0.98, 90.5, -0.25, 1000.0); hex(buf, n);
  n = w.build("/dream/wear/clutch", "ssii", "a1b2c3d4e5f6", "0123456789abcdef0123456789abcdef", (int32_t)1, (int32_t)7); hex(buf, n);
  Writer tiny(buf, 16);
  printf("%d\n", (int)tiny.build("/dream/wear/hello", "s", "too long for sixteen bytes"));   // does not fit: nothing
  for (int a = 1; a < argc; a++) {
    uint8_t in[256]; int m = unhex(argv[a], in); Message msg;
    if (!parse(in, m, &msg)) { printf("refused\n"); continue; }
    printf("%s", msg.address);
    for (size_t k = 0; k < msg.count; k++) {
      if (msg.args[k].type == 's') printf(" s:%s", msg.args[k].s);
      else printf(" %c:%g", msg.args[k].type, number(msg, k));
    }
    printf("\n");
  }
}
"""


@pytest.fixture(scope="module")
def prog(tmp_path_factory):
    if not CXX:
        pytest.skip("no C++ compiler")
    d = tmp_path_factory.mktemp("osc")
    src, exe = d / "osc.cpp", d / "osc"
    src.write_text(PROGRAM)
    subprocess.run([CXX, "-std=c++11", "-Wall", "-Werror", "-I", HEADER, str(src), "-o", str(exe)], check=True,
                   capture_output=True, timeout=120)
    return str(exe)


def run(prog, *packets) -> list:
    return subprocess.run([prog, *[p.hex() for p in packets]], check=True, capture_output=True, text=True, timeout=30).stdout.splitlines()


def test_dream_reads_what_the_firmware_writes(prog):
    hello, imu, clutch, tiny = run(prog)[:4]
    m = OscMessage(bytes.fromhex(hello))
    assert (m.address, list(m.params)) == ("/dream/wear/hello", ["a1b2c3d4e5f6", "sticks3", "", -1, "1.0.0"])
    m = OscMessage(bytes.fromhex(imu))
    assert m.address == "/dream/wear/imu" and m.params[:2] == ["a1b2c3d4e5f6", 123456]
    assert m.params[2:] == pytest.approx([0.5, -1.0, 0.98, 90.5, -0.25, 1000.0], abs=1e-5)
    m = OscMessage(bytes.fromhex(clutch))
    assert list(m.params) == ["a1b2c3d4e5f6", "0123456789abcdef0123456789abcdef", 1, 7]
    assert tiny == "0"


def test_the_firmware_reads_what_dream_writes_and_refuses_broken_packets(prog):
    state = wearables.osc("/dream/wear/state", 1, 1, 7)
    pair = wearables.osc("/dream/wear/pair", "0123456789abcdef0123456789abcdef")
    beat = wearables.osc("/dream/wear/beat", 0.75)
    broken = [state[:-2], b"/dream", b"x" * 16, state[:20] + b"\xff" * 4, b"/a\0\0,x\0\0" + b"\0" * 4]   # an unknown type
    out = run(prog, state, pair, beat, *broken)[4:]
    assert out[:3] == ["/dream/wear/state i:1 i:1 i:7", "/dream/wear/pair s:0123456789abcdef0123456789abcdef", "/dream/wear/beat f:0.75"]
    assert out[3:] == ["refused"] * len(broken)
