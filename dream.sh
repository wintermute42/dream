#!/bin/bash
# Starts Dream on this Mac; opens a browser only with --open (panel), --stage (stage) or --beamer (output window).
#   dream.sh            only on this Mac: http://127.0.0.1:7860
#   dream.sh --lan      also reachable in the home network for the phone remote (secret link, QR code on the stage)
#   dream.sh --stage    opens the stage without the panel (fullscreen on the projector: press F)
#   dream.sh --no-open  starts only the server (used by the autostart)
#   dream.sh --test-copy[=DIR]  a copy to try things in: its own folders (default ~/dream-test-copy) and ports
#                       7870/7470/7170, so the settings, keys and pictures of the real Dream stay untouched
#   dream.sh --beamer   also opens the output window (picture only, no controls, renders nothing itself) as a
#                       Chrome kiosk window on the second display; --beamer=X for its left edge in macOS (default 1920)
# Local settings (paths, ports) go into ~/.config/dream/dream.env as VAR=value lines; it is read on every start.
# Stop with Ctrl+C. The first local frame downloads SD-Turbo (~2.6 GB) and the tiny decoder (~10 MB).
set -euo pipefail
cd "$(dirname "$0")"

# #132/#133: messages in English, German (or another language) from static/i18n via i18n.py (LANG or DREAM_LANG)
tx() { python3 "$(dirname "$0")/i18n.py" "${DREAM_LANG:-}" "$@" 2>/dev/null || printf '%s\n' "$1"; }
usage() {
  tx "$(cat <<'HELP'
Dream – live AI dream. Starts Dream on this Mac (panel: http://127.0.0.1:7860, open it in the browser).

Usage:  ./dream.sh [options]

Options:
  --lan          also reachable in the home Wi-Fi: phone remote by QR code (key Q on the stage)
  --open         opens the panel in the browser as soon as Dream is ready (otherwise nothing opens)
  --stage        opens the stage without the panel in the browser (on the projector: F = fullscreen)
  --beamer       also opens the output window (picture only, does not compute) fullscreen on the second
                 display (Chrome kiosk); --beamer=X = left edge of the projector in pixels (default 1920)
  --no-open      opens no browser (the default; stays valid for the autostart)
  --test-copy    a copy to try things in: own folders (~/dream-test-copy, or --test-copy=DIR) and
                 port 7870 (https 7470, sensors 7170) – the real Dream and its settings stay untouched
  -h, --help     shows this help

Own settings (in ~/.config/dream/dream.env, one line per setting, not in the repository):
  DREAM_PORT=7860                 another port
  DREAM_SENSOR_PORT=7020          port for movement sensors (phone on the arm, wristband) via OSC
  DREAM_HTTPS_PORT=7443           port of Dream Control over https (with --lan; not 7861, the cloud tunnel)

Examples:
  ./dream.sh --lan                Dream with the phone remote
  ./dream.sh --lan --beamer       plus the picture output on the projector

Stop with Ctrl+C. More in the README (section "At a glance"); cloud GPU: ./dream-cloud.
HELP
)"
}
COPY=""
for a in "$@"; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
    --test-copy) COPY="$HOME/dream-test-copy" ;;
    --test-copy=*) COPY="${a#--test-copy=}" ;;
  esac
done
# #265: a test copy keeps everything in its own folders – its dream.env too (copy the real one there to take its
# settings) – and its own ports, whatever that dream.env says
if [ -n "$COPY" ]; then
  export DREAM_STATE_DIR="$COPY/state" DREAM_CONFIG_DIR="$COPY/config" DREAM_SAVE_DIR="$COPY/pictures"
  mkdir -p "$DREAM_STATE_DIR" "$DREAM_CONFIG_DIR" "$DREAM_SAVE_DIR"
  ENV_FILE="$DREAM_CONFIG_DIR/dream.env"
else
  ENV_FILE="${DREAM_ENV:-${DREAM_CONFIG_DIR:-$HOME/.config/dream}/dream.env}"   # #186: DREAM_CONFIG_DIR
fi
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
if [ -n "$COPY" ]; then
  export DREAM_STATE_DIR="$COPY/state" DREAM_CONFIG_DIR="$COPY/config" DREAM_SAVE_DIR="$COPY/pictures" \
    DREAM_PORT=7870 DREAM_HTTPS_PORT=7470 DREAM_SENSOR_PORT=7170
  tx "Test copy: folders in {0}, panel http://127.0.0.1:7870/ – the real Dream stays untouched." "$COPY"
fi
PORT="${DREAM_PORT:-7860}"
HOST=127.0.0.1; PAGE="http://127.0.0.1:$PORT/"; OPEN=0; BEAMER=""
for a in "$@"; do
  case "$a" in
    --lan) HOST=0.0.0.0; export DREAM_LAN=1 ;;
    --open) OPEN=1 ;;
    --stage) PAGE="http://127.0.0.1:$PORT/?stage=1"; OPEN=1 ;;
    --no-open) OPEN=0 ;;                      # the default; kept for the autostart
    --test-copy|--test-copy=*) ;;             # #265: read above
    --flow|--flow=*) tx "Note: --flow is gone – switch the movement detection on in Dream (switch “Movement”), Dream remembers it." >&2 ;;
    --beamer) BEAMER=1920 ;;
    --beamer=*) BEAMER="${a#--beamer=}"; [[ "$BEAMER" =~ ^-?[0-9]+$ ]] || { tx "--beamer=X: X is a number (pixels)." >&2; exit 2; } ;;
    *) tx "Unknown option: {0} (help: ./dream.sh --help)" "$a" >&2; exit 2 ;;
  esac
done
export HF_HUB_DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 PYTORCH_ENABLE_MPS_FALLBACK=1
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
[ -x "$UV" ] || { printf '✖ '; tx "uv is missing (brew install uv)." >&2; exit 1; }
# Once Dream answers: show where to find it, and open the browser only when asked (--open, --stage).
( for _ in $(seq 1 120); do
    if curl -s -o /dev/null "http://127.0.0.1:$PORT/health"; then
      tx "Dream is ready: panel {0}/ · stage {0}/?stage=1 · output {0}/output" "http://127.0.0.1:$PORT"
      [ "$OPEN" = 1 ] && open "$PAGE"
      exit 0
    fi
    sleep 2
  done ) &
if [ -n "$BEAMER" ]; then
  OUT="http://127.0.0.1:$PORT/output"
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ( for _ in $(seq 1 120); do curl -s -o /dev/null "http://127.0.0.1:$PORT/health" && break; sleep 2; done
    if [ -x "$CHROME" ]; then         # own profile, so the kiosk window doesn't join an open Chrome
      exec "$CHROME" --user-data-dir="${DREAM_STATE_DIR:-$HOME/.local/state/dream}/chrome-output" --no-first-run --kiosk \
        --window-position="$BEAMER,0" "$OUT" >/dev/null 2>&1
    else
      open "$OUT"; tx "Output opened: drag it to the second display, F = fullscreen (for it to happen by itself: Google Chrome)."
    fi ) &
fi
exec "$UV" run uvicorn server:app --host "$HOST" --port "$PORT"
