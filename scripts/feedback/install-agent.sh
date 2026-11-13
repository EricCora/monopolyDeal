#!/bin/bash
# Installs (or reinstalls) the report watcher as a launchd agent that starts at login and
# restarts if it stops. Run it from the main checkout: scripts/feedback/install-agent.sh
# Remove it with: launchctl bootout gui/$(id -u)/com.ericcora.monopolydeal-feedback
set -euo pipefail

LABEL=com.ericcora.monopolydeal-feedback
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/MonopolyDealFeedback"
NODE="$(command -v node)"
CONFIG="$HOME/.config/monopolydeal-feedback/config.json"

if [ ! -f "$CONFIG" ]; then
  echo "Missing $CONFIG. See scripts/feedback/README.md." >&2
  exit 1
fi
mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/scripts/feedback/watcher.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/watcher.log</string>
  <key>StandardErrorPath</key><string>$LOGS/watcher.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Watcher running. Log: $LOGS/watcher.log"
