#!/usr/bin/env bash
# wm.sh — ONE idempotent command for your whole Webcam Magic home AI stack.
#
#   ./wm.sh                    up: install anything missing + start everything
#                              (text+vision, the ngrok tunnel, voice, images)
#   ./wm.sh down               stop everything + free the RAM (the exact opposite)
#   ./wm.sh restart            down, then up
#   ./wm.sh status             what's running + your public URL
#   ./wm.sh heavy | light      switch the text model (default: light)
#   ./wm.sh tunnel [d] [tok]   set/refresh the ngrok domain+token (persists to
#                              ~/.webcam-magic.env); `up` then uses it automatically
#   ./wm.sh autostart          make the whole stack boot on its own, forever
#
# Safe to run when things are already up (or partly up): it only starts what's down
# and installs what's missing. Tunnel creds live in ~/.webcam-magic.env (never in the
# repo); webcam-magic uses its OWN ngrok account so it coexists with any other tunnel
# you run. The core services are login agents (auto-start on boot).
set -uo pipefail
cd "$(dirname "$0")" || { echo "✗ can't cd to the server dir"; exit 1; }
HERE="$(pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Durable creds (mirrors watch-together's ~/.watchtogether-relay.env): NGROK_DOMAIN +
# NGROK_AUTHTOKEN for webcam-magic's own ngrok account. In $HOME, never in the repo.
DURABLE="$HOME/.webcam-magic.env"
# shellcheck source=/dev/null
[ -f "$DURABLE" ] && { set -a; . "$DURABLE"; set +a; }
# shellcheck source=/dev/null
[ -f "$HERE/.env" ] && { set -a; . "$HERE/.env"; set +a; }

AGENTS=(com.webcam-magic.ollama com.webcam-magic.proxy com.webcam-magic.ngrok com.webcam-magic.media)
SD_PORT="${SD_PORT:-7860}"
SD_LOG="/tmp/webcam-magic-sd.log"
SD_REPO="${SD_REPO:-https://github.com/vladmandic/sdnext}"
SD_DEFAULT_DIR="${SD_DEFAULT_DIR:-$HOME/sdnext}"
SD_PYTHON="${SD_PYTHON:-}"   # force SD's venv Python; else auto-pick a torch-supported one (not 3.14+)

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
# PyTorch/SD don't support Python 3.14+ yet — pick a supported interpreter for SD's venv.
pick_python() {
  [ -n "$SD_PYTHON" ] && { echo "$SD_PYTHON"; return; }
  for p in python3.12 python3.11 python3.13 python3.10; do command -v "$p" >/dev/null 2>&1 && { echo "$p"; return; }; done
  echo python3
}

# --- self-install: bring up anything that's missing (idempotent) -----------
have() { command -v "$1" >/dev/null 2>&1; }
brew_ensure() {   # brew_ensure <cmd> [formula]
  have "$1" && return 0
  if ! have brew; then echo "  ⚠ need Homebrew to install $1 (https://brew.sh)"; return 1; fi
  echo "  ▶ installing ${2:-$1}…"; brew install "${2:-$1}" >/dev/null 2>&1 && echo "  ✅ $1" || { echo "  ⚠ couldn't install $1"; return 1; }
}
ollama_has() { ollama list 2>/dev/null | grep -q "$1"; }
pull_model() { ollama_up || return 0; ollama_has "$1" && return 0; echo "  ▶ pulling $1 (one-time, several GB)…"; ollama pull "$1" >/dev/null 2>&1 && echo "  ✅ $1" || echo "  ⚠ couldn't pull $1"; }
install_agent() {   # install_agent <label> <template-basename> [sed-expr]
  local P="$HOME/Library/LaunchAgents/${1}.plist"
  [ -f "$P" ] && return 0
  mkdir -p "$HOME/Library/LaunchAgents"
  if [ -n "${3:-}" ]; then sed "$3" "$HERE/$2" > "$P"; else cp "$HERE/$2" "$P"; fi
  echo "  ✅ installed agent $1"
}
ensure_core() {
  if ! have brew; then
    echo "  ✗ Homebrew is required (the one thing I can't auto-install unattended)."
    echo "    Install it once, then re-run ./wm.sh :"
    echo "    /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    exit 1
  fi
  brew_ensure ollama; brew_ensure node; brew_ensure ngrok || true
  install_agent com.webcam-magic.ollama com.webcam-magic.ollama.plist
  install_agent com.webcam-magic.proxy  com.webcam-magic.proxy.plist "s#__PROXY_JS__#${HERE}/proxy.js#g"
}
ensure_media() {
  [ -f "$HOME/Library/LaunchAgents/com.webcam-magic.media.plist" ] && return 0
  [ -x "$HERE/media/setup-media.sh" ] && { echo "  ▶ setting up media (voice + image proxy)…"; ( cd "$HERE/media" && ./setup-media.sh ) || true; }
}
ensure_sd() {
  [ -n "$(find_sd)" ] && return 0
  have git || brew_ensure git
  echo "  ▶ installing Stable Diffusion (SD.Next → $SD_DEFAULT_DIR, one-time)…"
  git clone --depth 1 "$SD_REPO" "$SD_DEFAULT_DIR" >/dev/null 2>&1 && echo "  ✅ cloned SD.Next (its first launch installs deps + a default model)" || echo "  ⚠ couldn't clone SD — see server/media/README.md"
}
# Point webcam-magic's tunnel at YOUR ngrok domain using ITS OWN account token
# (passed per-agent, so it does NOT touch the shared ngrok config and coexists with
# any other tunnel). Persists creds to ~/.webcam-magic.env so `up` can always bring
# the tunnel back unattended.
configure_ngrok() {   # $1=domain  $2=authtoken
  local domain="${1:-}" token="${2:-}"
  if [ -z "$domain" ] || [ -z "$token" ]; then echo "  ✗ need domain + token — run: ./wm.sh tunnel <domain> <token>  (or put them in ~/.webcam-magic.env)"; return 1; fi
  { printf 'NGROK_DOMAIN=%s\nNGROK_AUTHTOKEN=%s\n' "$domain" "$token" > "$DURABLE"; chmod 600 "$DURABLE"; } 2>/dev/null || true
  local P="$HOME/Library/LaunchAgents/com.webcam-magic.ngrok.plist"
  sed -e "s|__NGROK_DOMAIN__|${domain}|g" -e "s|__NGROK_AUTHTOKEN__|${token}|g" "$HERE/com.webcam-magic.ngrok.plist" > "$P"
  launchctl unload "$P" 2>/dev/null || true; launchctl load "$P"
  sleep 2
  if wm_ngrok_up; then echo "  ✅ tunnel → https://${domain}  (own ngrok account — coexists with any other tunnel)"; echo "     point the site once:  https://amsanghi.github.io/webcam-magic/?ai=https://${domain}&aimodel=active"
  else echo "  ⚠ ngrok didn't come up — check /tmp/webcam-magic-ngrok.log (bad token, or domain not reserved on this account)"; fi
}
# Bring the public tunnel up idempotently from stored creds (used by `up`).
ensure_tunnel() {
  wm_ngrok_up && { echo "  ✅ tunnel already up"; return 0; }
  if [ -n "${NGROK_DOMAIN:-}" ] && [ -n "${NGROK_AUTHTOKEN:-}" ]; then configure_ngrok "$NGROK_DOMAIN" "$NGROK_AUTHTOKEN"
  elif [ -f "$HOME/Library/LaunchAgents/com.webcam-magic.ngrok.plist" ]; then launchctl load "$HOME/Library/LaunchAgents/com.webcam-magic.ngrok.plist" 2>/dev/null || true; sleep 2; wm_ngrok_up && echo "  ✅ tunnel up" || echo "  ⚠ tunnel didn't start — check /tmp/webcam-magic-ngrok.log"
  else echo "  – no tunnel creds yet — ./wm.sh tunnel <domain> <token>  (or add them to ~/.webcam-magic.env)"; fi
}

load_agents()   { for a in "${AGENTS[@]}"; do P="$HOME/Library/LaunchAgents/${a}.plist"; [ -f "$P" ] && launchctl load   "$P" 2>/dev/null || true; done; }
unload_agents() { for a in "${AGENTS[@]}"; do P="$HOME/Library/LaunchAgents/${a}.plist"; [ -f "$P" ] && launchctl unload "$P" 2>/dev/null || true; done; }

start_sd() {
  if sd_up; then echo "  ✅ images (SD) already up on :$SD_PORT"; return; fi
  local dir; dir="$(find_sd)"
  if [ -z "$dir" ]; then echo "  – images: no SD install found — see server/media/README.md (skipping)"; return; fi
  # SD's venv must run a Python PyTorch supports — a 3.14+ venv can't install torch.
  local vpy="$dir/venv/bin/python3" py; py="$(pick_python)"
  if [ -x "$vpy" ] && ! "$vpy" -c 'import sys; sys.exit(0 if sys.version_info[:2] < (3,14) else 1)' 2>/dev/null; then
    echo "  ▶ SD venv on an unsupported Python — rebuilding with $py…"; rm -rf "$dir/venv"
  fi
  [ -x "$dir/venv/bin/python3" ] || { echo "  ▶ creating SD venv with $py…"; "$py" -m venv "$dir/venv" >/dev/null 2>&1 || echo "  ⚠ couldn't create venv with $py"; }
  # SD.Next's macOS MPS fix imports torchsde but doesn't always pull it → startup crash
  # (ValueError: Empty module name). Once torch is in, make sure torchsde is too.
  if "$dir/venv/bin/python3" -c "import torch" 2>/dev/null && ! "$dir/venv/bin/python3" -c "import torchsde" 2>/dev/null; then
    echo "  ▶ adding torchsde (SD.Next MPS fix needs it)…"; "$dir/venv/bin/pip" install -q torchsde >/dev/null 2>&1 || true
  fi
  echo "  ▶ starting SD ($dir) on :$SD_PORT … (first launch downloads torch + a model — slow)"
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
  pull_model "$active"          # heavy pulls the 26 GB model on demand — only when you ask for it
  ollama stop "$other" 2>/dev/null || true
  ollama rm active 2>/dev/null || true
  if ollama cp "$active" active 2>/dev/null; then
    curl -sf http://127.0.0.1:11434/api/generate -d "{\"model\":\"active\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":\"30m\"}" >/dev/null 2>&1 || true
    echo "  ✅ text model → $active"
  else echo "  ⚠ couldn't set '$active' (is it pulled? run ./setup.sh) — leaving the current one"; fi
}

# Our public tunnel = an ngrok agent actually forwarding the proxy (:11435). A
# different ngrok (e.g. another app on another port) does NOT count. The real URL
# comes from ngrok's local API, not the log (the log shows the domain even on error).
wm_ngrok_up() { pgrep -f "ngrok http 11435" >/dev/null 2>&1; }
other_ngrok() { pgrep -lf "ngrok http" 2>/dev/null | grep -qv "ngrok http 11435"; }
tunnel_url()  { curl -sf --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -oE 'https://[a-zA-Z0-9.-]+\.(ngrok[a-z.-]*|trycloudflare\.com)' | head -1; }

status() {
  echo "Webcam Magic — home AI status:"
  ollama_up && echo "  ✅ text + vision   (Ollama :11434)"      || echo "  ✗  text + vision   (Ollama :11434)"
  proxy_up  && echo "  ✅ local proxy     (:11435)"             || echo "  ✗  local proxy     (:11435)"
  media_up  && echo "  ✅ voice + images  (wm-media :8189)"     || echo "  ✗  voice + images  (wm-media :8189)"
  sd_up     && echo "  ✅ image gen       (Stable Diffusion :$SD_PORT)" || echo "  –  image gen       (SD not running)"
  if wm_ngrok_up; then
    echo "  ✅ public tunnel   (ngrok → :11435)"
    local u="${NGROK_DOMAIN:+https://$NGROK_DOMAIN}"; [ -z "$u" ] && u="$(tunnel_url)"; [ -n "$u" ] && echo "  🌐 public URL:     $u"
  else
    echo "  ✗  public tunnel   (webcam-magic's ngrok is NOT running — the site can't reach this server remotely)"
    other_ngrok && echo "     ↳ a different ngrok tunnel holds your account/domain; free ngrok allows only one. Fix: stop it, or move webcam-magic to Cloudflare (ask me)."
  fi
}

up() {
  local model="${1:-light}"   # light is the default — keeps the Mac free; heavy is opt-in
  if [ "${WM_NO_INSTALL:-}" != "1" ]; then
    echo "▶ checking prerequisites — installing anything missing…"
    ensure_core
    ensure_media
    ensure_sd
    echo
  fi
  echo "▶ bringing the whole stack up…"
  load_agents
  local ok=""; for _ in $(seq 1 20); do ollama_up && { ok=1; break; }; sleep 1; done
  if [ -n "$ok" ]; then
    if [ "${WM_NO_INSTALL:-}" != "1" ]; then pull_model dolphin3:8b; pull_model llama3.2-vision:11b; fi   # light text + vision
    model_switch "$model"
  else
    echo "  ⚠ Ollama still not up — check /tmp/webcam-magic-*.log"
  fi
  ensure_tunnel
  start_sd
  sleep 2
  echo
  status
  echo
  echo "✅ Done (model: $model). Idempotent — re-run ./wm.sh anytime; it installs what's missing and starts what's down."
  echo "   Stop everything:  ./wm.sh down       Boot on its own:  ./wm.sh autostart"
}

down() {
  echo "▶ taking it all down + freeing RAM…"
  stop_sd
  unload_agents
  pkill -f "ngrok http 11435" 2>/dev/null || true   # our tunnel only — leaves any other ngrok alone
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
  up)         up "${2:-light}" ;;
  down|stop)  down ;;
  restart)    down; sleep 1; up "${2:-light}" ;;
  status)     status ;;
  heavy)      model_switch heavy ;;
  light)      model_switch light ;;
  autostart)  autostart ;;
  sd)         start_sd ;;
  tunnel)     configure_ngrok "${2:-${NGROK_DOMAIN:-}}" "${3:-${NGROK_AUTHTOKEN:-}}" ;;
  *) echo "usage: ./wm.sh [ up [heavy|light] | down | restart | status | heavy | light | sd | tunnel [<domain> <token>] | autostart ]"; exit 1 ;;
esac
