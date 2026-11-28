#!/usr/bin/env bash
# Dream's worn devices (#277, #278): build the firmware and put it on a device plugged into this Mac by USB – no
# questions, no manual steps (also for an assistant that is asked "flash the stick").
#
#   firmware/flash.sh sticks3                   build and upload to the one StickS3 found by USB
#   firmware/flash.sh atoms3-receiver           … to the one AtomS3 Lite (the USB receiver, #278)
#   firmware/flash.sh <device> --port PORT      … to this serial port (e.g. /dev/cu.usbmodem1101)
#   firmware/flash.sh --list                    the boards plugged in right now, and which firmware fits each
#
# PlatformIO is installed with `uv tool install platformio` when it is missing. A board is found by its USB ids
# (NAMES/IDS below); none or several of a kind is an error that says what to do. The StickS3 and the AtomS3 Lite are
# both ESP32-S3 boards with the same USB ids: the device is always named, and with two such boards plugged in nothing
# is flashed without --port – flash them one at a time. While it runs, a note in Dream's state folder (`flashing`)
# makes a running Dream let go of every USB port (receiver.py), so Dream and the upload never share one. A failed
# upload is tried once more.
# Exit codes: 0 done · 1 build or upload failed · 2 wrong call · 3 no such board found · 4 several found (choose one
# with --port) · 5 PlatformIO missing and could not be installed.
# For the tests: PIO (the pio command) and UV (the uv command) may be given from outside; RETRY_WAIT and PAUSE_WAIT
# (seconds).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
# the boards: the firmware's name (its folder), the USB ids it is found by (VID:PID, upper case), what it is
NAMES=(sticks3 atoms3-receiver)
IDS=(303A:1001 303A:1001)
TITLES=("M5Stack StickS3 (ESP32-S3)" "M5Stack AtomS3 Lite, the USB receiver (ESP32-S3)")
RETRY_WAIT="${RETRY_WAIT:-3}"
PAUSE_WAIT="${PAUSE_WAIT:-3}"              # Dream looks at its USB ports every 2 s: then it has let go
STATE_DIR="${DREAM_STATE_DIR:-$HOME/.local/state/dream}"

say() { printf '%s\n' "$*"; }
fail() { local code="$1"; shift; printf 'flash: %s\n' "$*" >&2; exit "$code"; }

usage() {
  say "Usage: firmware/flash.sh <device> [--port PORT]   build and upload (device: $(names | tr '\n' ' '))"
  say "       firmware/flash.sh --list                     the boards plugged in right now"
}

names() { printf '%s\n' "${NAMES[@]}"; }
ids_of() { local i; for i in "${!NAMES[@]}"; do [ "${NAMES[$i]}" = "$1" ] && printf '%s\n' "${IDS[$i]}"; done; return 0; }
title_of() { local i; for i in "${!NAMES[@]}"; do [ "${NAMES[$i]}" = "$1" ] && printf '%s\n' "${TITLES[$i]}"; done; return 0; }
which_board() { local i; for i in "${!IDS[@]}"; do [ "${IDS[$i]}" = "$1" ] && printf '%s\n' "${NAMES[$i]}"; done; return 0; }
# the boards that share these USB ids, said as one: "sticks3 or atoms3-receiver"
boards_of() { which_board "$1" | awk 'NR > 1 { printf " or " } { printf "%s", $0 } END { if (NR) print "" }'; }
titles_of() { local n; which_board "$1" | while read -r n; do title_of "$n"; done | awk 'NR > 1 { printf " or " } { printf "%s", $0 } END { if (NR) print "" }'; }

# ---------- the arguments ----------
device="" port="" list=0
while [ $# -gt 0 ]; do
  case "$1" in
    --list) list=1 ;;
    --port) [ $# -ge 2 ] && [ -n "$2" ] || { usage >&2; fail 2 "--port needs a serial port"; }; port="$2"; shift ;;
    --port=*) port="${1#--port=}"; [ -n "$port" ] || { usage >&2; fail 2 "--port needs a serial port"; } ;;
    -h|--help) usage; exit 0 ;;
    -*) usage >&2; fail 2 "unknown option: $1" ;;
    *) [ -z "$device" ] || { usage >&2; fail 2 "one device at a time"; }; device="$1" ;;
  esac
  shift
done
if [ "$list" = 0 ]; then
  [ -n "$device" ] || { usage >&2; fail 2 "which device? ($(names | tr '\n' ' '))"; }
  [ -n "$(ids_of "$device")" ] && [ -d "$HERE/$device" ] || { usage >&2; fail 2 "unknown device: $device"; }
fi

# ---------- PlatformIO (installed when missing) ----------
find_pio() {
  if [ -n "${PIO:-}" ]; then printf '%s\n' "$PIO"; return 0; fi
  command -v pio 2>/dev/null && return 0
  [ -x "$HOME/.local/bin/pio" ] && { printf '%s\n' "$HOME/.local/bin/pio"; return 0; }
  return 1
}
if ! PIO_CMD="$(find_pio)"; then
  UV_CMD="${UV:-$(command -v uv 2>/dev/null || { [ -x "$HOME/.local/bin/uv" ] && printf '%s' "$HOME/.local/bin/uv"; })}"
  [ -n "$UV_CMD" ] || fail 5 "PlatformIO is missing and uv is not installed – install uv (https://docs.astral.sh/uv/) or PlatformIO"
  say "Installing PlatformIO (uv tool install platformio) …"
  "$UV_CMD" tool install platformio >/dev/null 2>&1 || fail 5 "PlatformIO could not be installed (uv tool install platformio failed)"
  PIO_CMD="$("$UV_CMD" tool dir --bin 2>/dev/null)/pio"
  [ -x "$PIO_CMD" ] || fail 5 "PlatformIO was installed but its pio command is not found"
fi

# ---------- the boards plugged in: "port<TAB>VID:PID<TAB>description", from PlatformIO's own list ----------
ports() {
  "$PIO_CMD" device list --serial --json-output 2>/dev/null | python3 -c '
import json, re, sys
try:
    items = json.load(sys.stdin)
except ValueError:
    items = []
for d in items if isinstance(items, list) else []:
    if not isinstance(d, dict) or not d.get("port"):
        continue
    m = re.search(r"VID:PID=([0-9A-Fa-f]{4}):([0-9A-Fa-f]{4})", str(d.get("hwid", "")))
    ids = (m.group(1) + ":" + m.group(2)).upper() if m else "-"
    print("%s\t%s\t%s" % (d["port"], ids, str(d.get("description", "")).replace("\t", " ")))
'
}

if [ "$list" = 1 ]; then
  found=0
  while IFS="$(printf '\t')" read -r p ids desc; do
    [ -n "$p" ] || continue
    name="$(boards_of "$ids")"
    if [ -n "$name" ]; then say "$name	$p	$(titles_of "$ids") [$ids]"; found=$((found + 1)); fi
  done <<EOF
$(ports)
EOF
  [ "$found" -gt 0 ] || say "No board of Dream's found by USB (plugged in, a data cable, switched on?)."
  exit 0
fi

# ---------- the port ----------
if [ -z "$port" ]; then
  want="$(ids_of "$device")"
  matches="$(ports | awk -F '\t' -v ids="$want" '$2 == ids { print $1 }')"
  count="$(printf '%s' "$matches" | grep -c . || true)"
  if [ "$count" = 0 ]; then
    fail 3 "no $(title_of "$device") found by USB – plug it in with a data cable and switch it on (or put it into download mode: README \"Worn devices\"), or name the port with --port"
  elif [ "$count" -gt 1 ]; then
    if [ "$(which_board "$want" | grep -c .)" -gt 1 ]; then
      fail 4 "$count boards with the USB ids of the $(title_of "$device") found ($(printf '%s' "$matches" | tr '\n' ' ')) – the StickS3 and the AtomS3 Lite are both ESP32-S3 boards with the same ids, so this cannot tell which one is the $(title_of "$device"). Unplug the other one and run this again, or name its port with --port (firmware/flash.sh --list)"
    fi
    fail 4 "several $(title_of "$device") found ($(printf '%s' "$matches" | tr '\n' ' ')) – unplug the others or choose one with --port"
  fi
  port="$matches"
fi

# ---------- a running Dream lets go of its USB ports meanwhile (#278, receiver.py) ----------
mkdir -p "$STATE_DIR" 2>/dev/null && printf '%s\n' "$$" > "$STATE_DIR/flashing" 2>/dev/null && {
  trap 'rm -f "$STATE_DIR/flashing"' EXIT
  trap 'exit 130' INT TERM
  sleep "$PAUSE_WAIT"
}

# ---------- build and upload, once more if it fails ----------
say "Flashing $(title_of "$device") on $port …"
[ "$(which_board "$(ids_of "$device")" | grep -c .)" -gt 1 ] && \
  say "(Over USB the StickS3 and the AtomS3 Lite look alike: the board on $port gets the $device firmware – flash them one at a time.)"
for attempt in 1 2; do
  if "$PIO_CMD" run -d "$HERE/$device" -t upload --upload-port "$port"; then
    say "Done: $(title_of "$device") on $port has the new firmware."
    exit 0
  fi
  [ "$attempt" = 1 ] && { say "The upload failed – trying once more in ${RETRY_WAIT} s …"; sleep "$RETRY_WAIT"; }
done
fail 1 "the upload to $port failed twice – check the cable, or put the board into download mode (README \"Worn devices\") and run this again"
