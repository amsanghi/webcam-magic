#!/usr/bin/env bash
# Webcam Magic — expose your local Ollama server to the website over https.
# (GitHub Pages is https, so the server must be reached over https too — hence a tunnel.)
#
# Usage:
#   ./start.sh              Cloudflare quick tunnel — no account, ephemeral https URL   [easiest]
#   ./start.sh --ngrok      ngrok — stable URL if you set NGROK_DOMAIN (free account)   [permanent]
#   ./start.sh --tailscale  only if you WANT to use your own tailnet (note: separate from work)
#
# Whatever URL it prints, open the site and run in the browser console:
#     wmAI.configure("<THE_URL>")
set -euo pipefail
MODE="${1:-cloudflare}"
PORT=11434

# Make sure Ollama is answering locally (setup.sh installs it as a login service).
if ! curl -sf "http://127.0.0.1:${PORT}/api/tags" >/dev/null 2>&1; then
  echo "▶ Ollama isn't responding — starting it…"
  OLLAMA_ORIGINS="https://amsanghi.github.io,http://localhost:*" nohup ollama serve >/tmp/webcam-magic-ollama.log 2>&1 &
  for i in $(seq 1 15); do curl -sf "http://127.0.0.1:${PORT}/api/tags" >/dev/null 2>&1 && break; sleep 1; done
fi
echo "▶ Ollama is up on http://127.0.0.1:${PORT}"
echo "   Then in the site's browser console:  wmAI.configure(\"<THE_URL_BELOW>\")"
echo

case "$MODE" in
  --ngrok)
    command -v ngrok >/dev/null 2>&1 || brew install ngrok
    if [ -n "${NGROK_DOMAIN:-}" ]; then
      echo "▶ ngrok on your stable domain: https://${NGROK_DOMAIN}"
      exec ngrok http "${PORT}" --url "https://${NGROK_DOMAIN}"
    else
      echo "▶ ngrok (ephemeral URL — set NGROK_DOMAIN=your-name.ngrok-free.app for a stable one):"
      exec ngrok http "${PORT}"
    fi
    ;;
  --tailscale)
    command -v tailscale >/dev/null 2>&1 || { echo "✗ Tailscale not installed"; exit 1; }
    echo "▶ Public https via Tailscale Funnel (uses YOUR tailnet — keep separate from work):"
    tailscale funnel --bg "${PORT}" || tailscale funnel "${PORT}" &
    sleep 2; tailscale funnel status || true
    ;;
  *)
    command -v cloudflared >/dev/null 2>&1 || brew install cloudflared
    echo "▶ Opening a public Cloudflare tunnel — copy the https://…trycloudflare.com URL it prints below."
    echo "   (Ephemeral: a new URL each run. For a permanent URL use ./start.sh --ngrok with NGROK_DOMAIN.)"
    exec cloudflared tunnel --url "http://localhost:${PORT}"
    ;;
esac
