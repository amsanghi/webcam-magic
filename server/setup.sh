#!/usr/bin/env bash
# Webcam Magic — home AI server setup (one-time). Installs Ollama, registers it
# as a login service (so it's always running), and pulls the models.
# Usage:  cd server && ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ Webcam Magic — home AI server setup"

command -v brew >/dev/null 2>&1 || { echo "✗ Homebrew not found. Install it first: https://brew.sh"; exit 1; }

if ! command -v ollama >/dev/null 2>&1; then
  echo "▶ Installing Ollama…"; brew install ollama
fi

# Install the LaunchAgent so Ollama runs on login with CORS allowed for the site.
PLIST_SRC="com.webcam-magic.ollama.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.webcam-magic.ollama.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"
echo "▶ Ollama registered as a login service (auto-starts on boot)."

# Give the service a moment to come up.
for i in $(seq 1 15); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done

echo "▶ Pulling models (several GB, one time — grab a coffee)…"
ollama pull hermes3:8b            # strong, steerable, low-refusal text model
ollama pull llama3.2-vision:11b   # image understanding (drop if you don't want vision)
# For a FULLY uncensored text model, also:  ollama pull dolphin3:8b
#   then set it in the browser:  wmAI.configure(URL, "dolphin3:8b")

echo
echo "✅ Setup complete. Ollama is running and will auto-start on login."
echo "   Next:  ./start.sh            (private, Tailscale)"
echo "          ./start.sh --funnel   (public URL, works on any device anywhere)"
echo "          ./start.sh --cloudflare"
echo "   See server/README.md for the full guide."
