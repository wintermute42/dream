"""#278: the receiver's firmware and Dream speak the same serial line – firmware/lib/DreamRadio/src/DreamRadio.h is
compiled for this computer with a small program that reads Dream's lines (as receiver.py writes them) the way the
AtomS3 does, and writes the receiver's peer list the way it says it in its H line; both are checked against
receiver.py. Also the radio frame's head and the peer table (six sticks at most, the longest paired makes way).
Skipped without a C++ compiler; nothing touches a device."""
import os
import shutil
import subprocess

import pytest

import receiver
import wearables

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEADER = os.path.join(ROOT, "firmware", "lib", "DreamRadio", "src")
CXX = shutil.which("c++") or shutil.which("g++") or shutil.which("clang++")
STICK = "a1b2c3d4e5f6"

PROGRAM = r"""
#include <stdio.h>
#include <string.h>
#include "DreamRadio.h"
using namespace dream_radio;
int main(int argc, char** argv) {
  if (argc > 1 && strcmp(argv[1], "peers") == 0) {         // the H line's last word as the table grows
    Peers peers;
    char text[MAX_PEERS * 14 + 2];
    peers.text(text, sizeof text); printf("%s\n", text);
    for (int k = 0; k < 8; k++) {
      uint8_t mac[6] = {0xa1, 0xb2, 0xc3, 0xd4, 0xe5, static_cast<uint8_t>(k)}, key[KEY] = {0};
      Peer* p = peers.add(mac, key);
      if (k % 2) p->fresh = 0;
      peers.text(text, sizeof text); printf("%d %s\n", peers.count(), text);
    }
    uint8_t again[6] = {0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0x07}, key[KEY] = {1};
    peers.add(again, key);                                  // paired again: the same place, fresh, a new key
    peers.text(text, sizeof text); printf("%d %s %d\n", peers.count(), text, peers.find(again)->key[0]);
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "frames") == 0) {
    uint8_t f[MAX_FRAME];
    size_t n = head(f, sizeof f, OSC);
    printf("%zu %c %c\n", n, typeOf(f, n) ? typeOf(f, n) : '-', typeOf(f, 2) ? 'x' : '-');
    f[1] = 9; printf("%c\n", typeOf(f, 3) ? 'x' : '-');      // another version: not ours
    f[1] = VERSION; f[2] = 'Z'; printf("%c\n", typeOf(f, 3) ? 'x' : '-');
    return 0;
  }
  for (int a = 1; a < argc; a++) {                          // Dream's lines, read as the receiver reads them
    Command c;
    if (!readCommand(argv[a], strlen(argv[a]), &c)) { printf("refused\n"); continue; }
    char mac[13]; macText(c.mac, mac);
    switch (c.what) {
      case 'T': { char hex[2 * MAX_FRAME + 1]; toHex(c.data, c.len, hex, sizeof hex); printf("T %s %s\n", mac, hex); break; }
      case 'K': printf("K %s\n", mac); break;
      case 'L': printf("L %c\n", c.led); break;
      case 'C': printf("C %d\n", c.channel); break;
      default: printf("%c\n", c.what);
    }
  }
}
"""


@pytest.fixture(scope="module")
def prog(tmp_path_factory):
    if not CXX:
        pytest.skip("no C++ compiler")
    d = tmp_path_factory.mktemp("radio")
    src, exe = d / "radio.cpp", d / "radio"
    src.write_text(PROGRAM)
    subprocess.run([CXX, "-std=c++11", "-Wall", "-Werror", "-I", HEADER, str(src), "-o", str(exe)], check=True,
                   capture_output=True, timeout=120)
    return str(exe)


def run(prog, *args) -> list:
    return subprocess.run([prog, *args], check=True, capture_output=True, text=True, timeout=30).stdout.splitlines()


class Line:
    def __init__(self):
        self.lines = []

    def __call__(self, text):
        self.lines.append(text)
        return True


def test_the_receiver_reads_every_line_dream_writes(prog):
    r = receiver.Receiver("/dev/null", -1, wearables.Wearables(), loop=None)
    r.write = out = Line()
    packet = wearables.osc(wearables.PREFIX + "state", 1, 1, 7)
    r.sendto(packet, ("esp-now", STICK))
    lines = out.lines + ["L g", "L b", "L r", f"K {STICK}", "W", "?", "C 1", "C 13", "C 6\r"]
    assert run(prog, *lines) == [f"T {STICK} {packet.hex()}", "L g", "L b", "L r", f"K {STICK}", "W", "?", "C 1",
                                 "C 13", "C 6"]


@pytest.mark.parametrize("line", ["", "T", f"T {STICK}", f"T {STICK} 0", f"T {STICK} zz", f"T {STICK.upper()} 00",
                                  "T a1b2c3 0000", "L x", "L gg", "C 0", "C 14", "C 1x", "K 123", "W now", "?x", "Q",
                                  f"T {STICK} " + "00" * 248])
def test_the_receiver_refuses_what_is_not_one_of_dreams_lines(prog, line):
    assert run(prog, line) == ["refused"]


def test_its_peer_list_is_said_as_dream_reads_it(prog):
    out = run(prog, "peers")
    assert out[0] == "-"
    r = receiver.Receiver("/dev/null", -1, wearables.Wearables(), loop=None)
    for k, text in enumerate(out[1:9]):
        count, peers = text.split(" ")
        r.line(f"H 1 c0ffee123456 1.0.0 1 0 {peers}", 1.0, 1.0)
        assert len(r.peers) == int(count) == min(k + 1, 6)
    # eight paired into six places: the two longest paired made way; the even ones are still "fresh" (*)
    assert r.peers == {f"a1b2c3d4e50{k}": k % 2 == 0 for k in range(2, 8)}
    count, peers, key = out[9].split(" ")
    assert (count, key) == ("6", "1") and peers.endswith("a1b2c3d4e507*")


def test_the_radio_frame_head(prog):
    assert run(prog, "frames") == ["3 O -", "-", "-"]
