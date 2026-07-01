#!/usr/bin/env bash
# wm.sh — ONE command to run your whole Webcam Magic home AI stack.
#
#   ./wm.sh                    bring EVERYTHING up (text+vision, tunnel, voice, images)
#   ./wm.sh up [heavy|light]   same; pick the Ollama text model (default: light)
#   ./wm.sh down               take it all down + free all the RAM
#   ./wm.sh status             show what's running + your public URL
#   ./wm.sh heavy | light      just switch the text model (no restart)
#   ./wm.sh autostart          make the WHOLE stack (incl. images) launch on every
#                              boot — then you never run a script again
#
# Ollama / proxy / ngrok / wm-media are login agents (auto-start on boot after
# setup.sh + media/setup-media.sh). The Stable Diffusion image server is the one
# heavy piece that isn't — this script starts it too, and `autostart` makes it a
# login agent as well. Nothing here needs to be re-run daily.
set -uo pipefail
cd "$(dirname "$0")" || { echo "✗ can't cd to the server dir"; exit 1; }
HERE="$(pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

AGENTS=(com.webcam-magic.ollama com.webcam-magic.proxy com.webcam-magic.ngrok com.webcam-magic.media)
SD_PORT="${SD_PORT:-7860}"
SD_LOG="/tmp/webcam-magic-sd.log"

# --- probes ----------------------------------------------------------------
ollama_up() { curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; }
proxy_up()  { curl -sf http://127.0.0.1:11435/api/tags >/dev/null 2>&1; }
media_up()  { curl -sf http://127.0.0.1:8189/health   >/dev/null 2>&1; }
sd_up()     { curl -sf "http://127.0.0.1:${SD_PORT}/sdapi/v1/options" >/dev/null 2>&1; }

# --- where is the Stable Diffusion install? (override with SD_DIR=...) ------
find_sd() {
  if [ -n "${SD_DIR:-}" ]; then [ -x "${SD_DIR}/webui.sh" ] && echo "$SD_DIR"; return; fi
  for d in "$HOME/sdnext" "$HOME/stable-diffusion-webui" "$HOME/forge" "$HERE/media/sdnext"; do
    [ -x "$d/webui.sh" ] && { echo "$d"; return; }
  done
}

load_agents()   { for a in "${AGENTS[@]}"; do P="$HOME/Library/LaunchAgents/${a}.plist"; [ -f "$P" ] && launchctl load   "$P" 2>/dev/null || true; done; }
unload_agents() { for a in "${AGENTS[@]}"; do P="$HOME/Library/LaunchAgents/${a}.plist"; [ -f "$P" ] && launchctl unload "$P" 2>/dev/null || true; done; }

start_sd() {
  if sd_up; then echo "  ✅ images (SD) already up on :$SD_PORT"; return; fi
  local dir; dir="$(find_sd)"
  if [ -z "$dir" ]; then echo "  – images: no SD install found — see server/media/README.md (skipping)"; return; fi
  echo "  ▶ starting SD ($dir) on :$SD_PORT … (first launch is slow)"
  ( cd "$dir" && nohup bash ./webui.sh ${SD_CMD:---api --listen --port ${SD_PORT}} >"$SD_LOG" 2>&1 & )
}
stop_sd() { pkill -f "webui.sh" 2>/dev/null || true; pkill -f "launch.py" 2>/dev/null || true; }

model_switch() {   # heavy|light via the "active" alias (site always requests "active")
  local which="$1" active other
  case "$which" in
    heavy) active="dolphin-mixtral:8x7b"; other="dolphin3:8b" ;;
    light) active="dolphin3:8b";          other="dolphin-mixtral:8x7b" ;;
    *) return ;;
  esac
  ollama_up || return
  ollama stop "$other" 2>/dev/null || true
  ollama rm active 2>/dev/null || true
  if ollama cp "$active" active 2>/dev/null; then
    curl -sf http://127.0.0.1:11434/api/generate -d "{\"model\":\"active\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":\"30m\"}" >/dev/null 2>&1 || true
    echo "  ✅ text model → $active"
  else echo "  ⚠ couldn't set '$active' (is it pulled? run ./setup.sh) — leaving the current one"; fi
}

public_url() { grep -oE 'https://[a-zA-Z0-9.-]+\.(ngrok[a-z.-]*|trycloudflare\.com)' /tmp/webcam-magic-ngrok.log 2>/dev/null | tail -1; }

status() {
  echo "Webcam Magic — home AI status:"
  ollama_up && echo "  ✅ text + vision   (Ollama :11434)"      || echo "  ✗  text + vision   (Ollama :11434)"
  proxy_up  && echo "  ✅ tunnel proxy    (:11435 → your URL)"  || echo "  ✗  tunnel proxy    (:11435)"
  media_up  && echo "  ✅ voice + images  (wm-media :8189)"     || echo "  ✗  voice + images  (wm-media :8189)"
  sd_up     && echo "  ✅ image gen       (Stable Diffusion :$SD_PORT)" || echo "  –  image gen       (SD not running)"
  local u; u="$(public_url)"; [ -n "$u" ] && echo "  🌐 public URL:     $u"
}

up() {
  echo "▶ bringing the whole stack up…"
  load_agents
  local ok=""; for _ in $(seq 1 20); do ollama_up && { ok=1; break; }; sleep 1; done
  [ -z "$ok" ] && echo "  ⚠ Ollama didn't come up — run ./setup.sh once first (it installs the services)."
  [ -n "$ok" ] && model_switch "${1:-light}"
  start_sd
  sleep 2
  echo
  status
  echo
  echo "✅ Up. Models load on first use, so the first message/photo is slow, then fast."
  echo "   Nothing to re-run daily — the core services auto-start on boot."
  echo "   Want images to auto-start too? run:  ./wm.sh autostart"
}

down() {
  echo "▶ taking it all down + freeing RAM…"
  stop_sd
  unload_agents
  echo "✅ Down. The site falls back to on-device / static. Bring it back with:  ./wm.sh"
}

autostart() {
  local dir; dir="$(find_sd)"
  if [ -z "$dir" ]; then echo "✗ No SD install found yet. Install it (server/media/README.md), then re-run: ./wm.sh autostart"; exit 1; fi
  local P="$HOME/Library/LaunchAgents/com.webcam-magic.sd.plist"
  cat > "$P" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.webcam-magic.sd</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>${dir}/webui.sh</string><string>--api</string><string>--listen</string><string>--port</string><string>${SD_PORT}</string></array>
  <key>WorkingDirectory</key><string>${dir}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${SD_LOG}</string>
  <key>StandardErrorPath</key><string>${SD_LOG}</string>
</dict></plist>
PLIST
  launchctl unload "$P" 2>/dev/null || true; launchctl load "$P"
  echo "✅ Autostart on. The whole stack — text, vision, tunnel, voice, AND images —"
  echo "   now launches on every boot. You never need to run a script again."
  echo "   (Undo:  launchctl unload \"$P\" && rm \"$P\")"
}

case "${1:-up}" in
  up)        up "${2:-light}" ;;
  down|stop) down ;;
  status)    status ;;
  heavy)     model_switch heavy ;;
  light)     model_switch light ;;
  autostart) autostart ;;
  *) echo "usage: ./wm.sh [ up [heavy|light] | down | status | heavy | light | autostart ]"; exit 1 ;;
esac
