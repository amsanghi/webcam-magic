#!/usr/bin/env bash
# Webcam Magic — home AI server setup (one-time).
# Installs Ollama + ngrok, runs them as always-on login services, pulls both
# models, and creates an "active" alias the website always talks to.
#
# For the PERMANENT ngrok URL, first grab a free static domain
#   https://dashboard.ngrok.com  → Domains  (e.g. yourname.ngrok-free.app)
#   https://dashboard.ngrok.com  → Your Authtoken
# then run:
#   NGROK_DOMAIN=yourname.ngrok-free.app NGROK_AUTHTOKEN=xxth ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"
echo "▶ Webcam Magic — home AI server setup"

command -v brew >/dev/null 2>&1 || { echo "✗ Install Homebrew first: https://brew.sh"; exit 1; }
command -v ollama >/dev/null 2>&1 || { echo "▶ Installing Ollama…"; brew install ollama; }
command -v ngrok  >/dev/null 2>&1 || { echo "▶ Installing ngrok…";  brew install ngrok; }

# Ollama as a login service (auto-start on boot, CORS allowed for the site).
OPLIST="$HOME/Library/LaunchAgents/com.webcam-magic.ollama.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cp com.webcam-magic.ollama.plist "$OPLIST"
launchctl unload "$OPLIST" 2>/dev/null || true; launchctl load "$OPLIST"
for i in $(seq 1 15); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done

# CORS/Host-rewrite proxy in front of Ollama on :11435 (ngrok points here). Needed
# so browser fetches through ngrok work — see proxy.js. Runs as a login service.
PPLIST="$HOME/Library/LaunchAgents/com.webcam-magic.proxy.plist"
sed "s#__PROXY_JS__#$(pwd)/proxy.js#g" com.webcam-magic.proxy.plist > "$PPLIST"
launchctl unload "$PPLIST" 2>/dev/null || true; launchctl load "$PPLIST"

echo "▶ Pulling models (several GB, one time)…"
ollama pull dolphin-mixtral:8x7b   # heavy: best, fully uncensored (~26GB)
ollama pull dolphin3:8b            # light: fast, uncensored — use when you're also on the Mac
ollama pull llama3.2-vision:11b    # optional: image understanding

# "active" alias — the website ALWAYS requests model "active"; ./start.sh re-points it,
# so you change capability without ever touching the website or the URL.
ollama rm active 2>/dev/null || true
ollama cp dolphin-mixtral:8x7b active
echo "▶ active → dolphin-mixtral:8x7b  (switch anytime: ./start.sh light | ./start.sh heavy)"

# Permanent ngrok tunnel on YOUR static domain → the URL never changes. The token is
# baked into THIS agent (--authtoken in the plist), not the shared ngrok config, so it
# can use its own ngrok account and coexist with any other ngrok tunnel you run.
if [ -n "${NGROK_DOMAIN:-}" ] && [ -n "${NGROK_AUTHTOKEN:-}" ]; then
  NPLIST="$HOME/Library/LaunchAgents/com.webcam-magic.ngrok.plist"
  sed -e "s|__NGROK_DOMAIN__|${NGROK_DOMAIN}|g" -e "s|__NGROK_AUTHTOKEN__|${NGROK_AUTHTOKEN}|g" com.webcam-magic.ngrok.plist > "$NPLIST"
  launchctl unload "$NPLIST" 2>/dev/null || true; launchctl load "$NPLIST"
  echo
  echo "✅ Permanent tunnel: https://${NGROK_DOMAIN}"
  echo "   Point each device ONCE (link, or the ✨ AI pill):"
  echo "     https://amsanghi.github.io/webcam-magic/?ai=https://${NGROK_DOMAIN}&aimodel=active"
else
  echo
  echo "⚠ No NGROK_DOMAIN + NGROK_AUTHTOKEN given — Ollama + models are ready, but the tunnel isn't set."
  echo "  Grab a free static domain + authtoken at https://dashboard.ngrok.com (a SEPARATE ngrok account is"
  echo "  fine if you already run another tunnel), then:  ./wm.sh tunnel <your-domain> <authtoken>"
fi
echo
echo "✅ Done. Heavy when idle:  ./start.sh heavy    Light when using the Mac:  ./start.sh light"
