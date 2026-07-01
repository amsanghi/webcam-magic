#!/usr/bin/env bash
# Webcam Magic — switch which model the server runs, without changing the URL.
# The website always talks to the alias "active"; this re-points it and unloads
# the other model. The (permanent) ngrok tunnel is untouched, so nothing on the
# website side changes — capability just goes up or down.
#
#   ./start.sh heavy    # dolphin-mixtral:8x7b — best, when you're not using the Mac for much
#   ./start.sh light    # dolphin3:8b          — fast + frees ~26GB, when you want the Mac free
set -euo pipefail
WHICH="${1:-}"
case "$WHICH" in
  heavy) ACTIVE="dolphin-mixtral:8x7b"; OTHER="dolphin3:8b" ;;
  light) ACTIVE="dolphin3:8b";          OTHER="dolphin-mixtral:8x7b" ;;
  *) echo "usage: ./start.sh heavy|light"; echo "  heavy = dolphin-mixtral:8x7b (best)"; echo "  light = dolphin3:8b (frees the Mac)"; exit 1 ;;
esac

# bring the server back up if it was stopped (reload the login services)
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "▶ Server not up — starting it…"
  for agent in com.webcam-magic.ollama com.webcam-magic.ngrok; do
    P="$HOME/Library/LaunchAgents/${agent}.plist"; [ -f "$P" ] && launchctl load "$P" 2>/dev/null || true
  done
  for i in $(seq 1 20); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || { echo "✗ Ollama still not up — run ./setup.sh first."; exit 1; }
fi

echo "▶ Switching to ${WHICH} (${ACTIVE})…"
ollama stop "$OTHER" 2>/dev/null || true        # free the other model's memory now
ollama rm active 2>/dev/null || true
ollama cp "$ACTIVE" active                        # website keeps requesting model "active"
# warm it so the first message is snappy, and keep it resident
curl -sf http://127.0.0.1:11434/api/generate \
  -d "{\"model\":\"active\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":\"30m\"}" >/dev/null 2>&1 || true
echo "✅ Now serving ${ACTIVE} as \"active\". URL unchanged — nothing to change on the site."
