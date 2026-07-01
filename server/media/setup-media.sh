#!/usr/bin/env bash
# Webcam Magic — media server setup (images + optional voice), one-time.
#
# Adds the generative layer to your home server: image generation (couple photos,
# scene teleport, "stylize us"), plus optional neural TTS + Whisper STT. The tiny
# node service `wm-media.js` runs as a login agent on :8189; the existing proxy.js
# already routes /img /tts /stt to it, so it rides the SAME ngrok tunnel — no new
# URL, nothing to change on the site.
#
# Run AFTER server/setup.sh (which installs Ollama + proxy + ngrok):
#   cd server/media && ./setup-media.sh
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
echo "▶ Webcam Magic — media server setup"

command -v brew >/dev/null 2>&1 || { echo "✗ Install Homebrew first: https://brew.sh"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "▶ Installing node…"; brew install node; }

MODELS="$HERE/models"; mkdir -p "$MODELS"

# --- optional voice tooling (small models; safe to skip if it fails) ---------
PIPER_VOICE=""; WHISPER_MODEL=""
echo "▶ Optional voice tools (Piper TTS + whisper.cpp STT)…"
brew list piper-tts >/dev/null 2>&1 || brew install piper-tts 2>/dev/null || echo "  (skip piper — install later)"
brew list whisper-cpp >/dev/null 2>&1 || brew install whisper-cpp 2>/dev/null || echo "  (skip whisper — install later)"
# a small English Piper voice
if [ ! -f "$MODELS/en_US-amy-medium.onnx" ]; then
  curl -fsSL -o "$MODELS/en_US-amy-medium.onnx"      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx" 2>/dev/null \
    && curl -fsSL -o "$MODELS/en_US-amy-medium.onnx.json" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json" 2>/dev/null \
    && PIPER_VOICE="$MODELS/en_US-amy-medium.onnx" || echo "  (piper voice download skipped)"
else PIPER_VOICE="$MODELS/en_US-amy-medium.onnx"; fi
# a small Whisper model for STT
if [ ! -f "$MODELS/ggml-base.en.bin" ]; then
  curl -fsSL -o "$MODELS/ggml-base.en.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" 2>/dev/null \
    && WHISPER_MODEL="$MODELS/ggml-base.en.bin" || echo "  (whisper model download skipped)"
else WHISPER_MODEL="$MODELS/ggml-base.en.bin"; fi

# --- install the media service as a login agent ------------------------------
PLIST="$HOME/Library/LaunchAgents/com.webcam-magic.media.plist"
sed -e "s#__MEDIA_JS__#$HERE/wm-media.js#g" \
    -e "s#__PIPER_VOICE__#${PIPER_VOICE}#g" \
    -e "s#__WHISPER_MODEL__#${WHISPER_MODEL}#g" \
    com.webcam-magic.media.plist > "$PLIST"
launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"
sleep 1
echo "✅ wm-media running on :8189 (health: curl -s localhost:8189/health)"

# --- image backend (Stable Diffusion) — big + interactive, so we guide it ----
if curl -sf http://127.0.0.1:7860/sdapi/v1/options >/dev/null 2>&1; then
  echo "✅ An A1111-compatible SD server is already up on :7860 — images will work now."
else
  cat <<'EOF'

▶ NEXT: install a Stable Diffusion backend with an API on :7860 (one-time, several GB).
  Recommended on M1 Max (Apple MPS): SD.Next  — https://github.com/vladmandic/sdnext
    git clone https://github.com/vladmandic/sdnext ~/sdnext
    cd ~/sdnext && ./webui.sh --api --listen --port 7860
  (A1111 or Forge work too — any server exposing /sdapi/v1/txt2img.)

  Then grab a model (SDXL is a good default on 32 GB):
    • SDXL base (SFW/versatile) or an uncensored SDXL/Pony checkpoint from civitai/HF
      into the backend's models/Stable-diffusion folder.
  Face fidelity ("looks like US"): add the ReActor (face-swap) or IP-Adapter/InstantID
  extension in the SD UI — wm-media's img2img already preserves likeness at denoise ~0.55.

Once :7860 is up, the site's Portrait Studio + photo-dares work with no other changes.
EOF
fi

echo
echo "✅ Media layer installed. It shares your existing tunnel via proxy.js (/img /tts /stt)."
echo "   Test end-to-end from a browser console on the site:"
echo "     wmAI.image({prompt:'a cozy candlelit cabin, two mugs of cocoa'}).then(console.log)"
