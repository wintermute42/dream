#!/bin/bash
# Installation mode: starts Dream automatically after login and shows the stage fullscreen in its own
# Chrome window (own profile, camera/microphone allowed, sound without click), keeps the display awake.
#   install-autostart.sh [--lan] [--x 1920]   install (x = left edge of the projector display in macOS)
#   install-autostart.sh --remove              remove again
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"
tx() { python3 "$DIR/i18n.py" "${DREAM_LANG:-}" "$@" 2>/dev/null || printf '%s\n' "$1"; }   # #133: messages in the user's language
AGENTS="$HOME/Library/LaunchAgents"
SERVER_LABEL="local.dream.server"
STAGE_LABEL="local.dream.stage"
LOGS="$HOME/Library/Logs"
STATE="$HOME/.local/state/dream"
LAN=""; X=0
while [ $# -gt 0 ]; do
  case "$1" in
    --remove)
      for l in "$SERVER_LABEL" "$STAGE_LABEL"; do
        launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
        rm -f "$AGENTS/$l.plist"
      done
      tx "Autostart removed."; exit 0 ;;
    --lan) LAN="--lan"; shift ;;
    --x) X="$2"; shift 2 ;;
    *) tx "Unknown option: {0}" "$1" >&2; exit 2 ;;
  esac
done
case "$X" in ''|*[!0-9-]*) tx "--x needs a number" >&2; exit 2 ;; esac
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { tx "Google Chrome is missing (for the stage window)." >&2; exit 1; }
mkdir -p "$AGENTS" "$LOGS" "$STATE/chrome"

cat > "$AGENTS/$SERVER_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$SERVER_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-di</string>
    <string>$DIR/dream.sh</string><string>--no-open</string>${LAN:+<string>$LAN</string>}
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/dream.log</string>
  <key>StandardErrorPath</key><string>$LOGS/dream.log</string>
</dict></plist>
PLIST

cat > "$AGENTS/$STAGE_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$STAGE_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>-c</string>
    <string>until curl -s -o /dev/null http://127.0.0.1:7860/health; do sleep 2; done; exec "$CHROME" --user-data-dir="$STATE/chrome" --no-first-run --kiosk --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --window-position=$X,0 "http://127.0.0.1:7860/?stage=1"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardErrorPath</key><string>$LOGS/dream-stage.log</string>
</dict></plist>
PLIST

for l in "$SERVER_LABEL" "$STAGE_LABEL"; do
  plutil -lint "$AGENTS/$l.plist" >/dev/null
  launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$l.plist"
done
tx "Autostart set up. Dream starts after every login, the stage appears fullscreen at x={0}." "$X"
tx "Remove: {0} --remove" "$0"
