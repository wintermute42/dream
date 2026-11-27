#!/usr/bin/env bash
# Dream's worn devices (#277): build the firmware and put it on a device plugged into this Mac by USB – no questions,
# no manual steps (also for an assistant that is asked "flash the stick").
#
#   firmware/flash.sh sticks3               build and upload to the one StickS3 found by USB
#   firmware/flash.sh sticks3 --port PORT   … to this serial port (e.g. /dev/cu.usbmodem1101)
#   firmware/flash.sh --list                the boards plugged in right now, and which firmware fits each
#
# PlatformIO is installed with `uv tool install platformio` when it is missing. A board is found by its USB ids
# (NAMES/IDS below); none or several of a kind is an error that says what to do. A failed upload is tried once more.
# Exit codes: 0 done · 1 build or upload failed · 2 wrong call · 3 no such board found · 4 several found (choose one
# with --port) · 5 PlatformIO missing and could not be installed.
# For the tests: PIO (the pio command) and UV (the uv command) may be given from outside; RETRY_WAIT (seconds).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
# the boards: the firmware's name (its folder), the USB ids it is found by (VID:PID, upper case), what it is
NAMES=(sticks3)
IDS=(303A:1001)
TITLES=("M5Stack StickS3 (ESP32-S3)")
RETRY_WAIT="${RETRY_WAIT:-3}"

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
    name="$(which_board "$ids")"
    if [ -n "$name" ]; then say "$name	$p	$(title_of "$name") [$ids]"; found=$((found + 1)); fi
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
    fail 4 "several $(title_of "$device") found ($(printf '%s' "$matches" | tr '\n' ' ')) – unplug the others or choose one with --port"
  fi
  port="$matches"
fi

# ---------- build and upload, once more if it fails ----------
say "Flashing $(title_of "$device") on $port …"
for attempt in 1 2; do
  if "$PIO_CMD" run -d "$HERE/$device" -t upload --upload-port "$port"; then
    say "Done: $(title_of "$device") on $port has the new firmware."
    exit 0
  fi
  [ "$attempt" = 1 ] && { say "The upload failed – trying once more in ${RETRY_WAIT} s …"; sleep "$RETRY_WAIT"; }
done
fail 1 "the upload to $port failed twice – check the cable, or put the board into download mode (README \"Worn devices\") and run this again"
