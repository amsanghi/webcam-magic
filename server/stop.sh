#!/usr/bin/env bash
# Webcam Magic — stop the home AI server: unload the models (free RAM) and take
# down the tunnel + Ollama service. The site auto-falls back to on-device/static.
# Bring it back anytime with ./start.sh heavy|light (it also returns on reboot).
set -euo pipefail
echo "▶ Stopping the home AI server…"

# free model memory (whichever is loaded)
for m in active dolphin-mixtral:8x7b dolphin3:8b; do ollama stop "$m" 2>/dev/null || true; done

# take down the tunnel + Ollama login services (this session)
for agent in com.webcam-magic.ngrok com.webcam-magic.proxy com.webcam-magic.ollama; do
  P="$HOME/Library/LaunchAgents/${agent}.plist"
  [ -f "$P" ] && launchctl unload "$P" 2>/dev/null || true
done

# belt-and-suspenders in case anything was started by hand
pkill -f "ngrok http" 2>/dev/null || true
pkill -f "server/proxy.js" 2>/dev/null || true

echo "✅ Stopped: tunnel down, models unloaded, RAM freed."
echo "   The site now falls back to on-device / static automatically."
echo "   Bring it back:  ./start.sh heavy   (or ./start.sh light)"
echo "   (It also restarts on its own after a reboot / login.)"
