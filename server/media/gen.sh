#!/usr/bin/env bash
# gen.sh — quick way to test Stable Diffusion: send a prompt, get a photo.
# Uses the SAME /img endpoint the site uses (wm-media → SD.Next), saves a PNG,
# and opens it.
#
#   ./gen.sh a happy couple holding hands on a beach at sunset, photorealistic
#   STEPS=28 W=1024 H=1024 ./gen.sh a cozy candlelit dinner for two
#   NEG="blurry, extra limbs" ./gen.sh ...            # negative prompt
#   INIT=/path/to/frame.jpg ./gen.sh stylize us as an oil painting   # img2img
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
PROMPT="$*"
[ -z "$PROMPT" ] && { echo "usage: ./gen.sh <your prompt>   (env: STEPS W H NEG INIT OUT_DIR WM_MEDIA_URL)"; exit 1; }
MEDIA="${WM_MEDIA_URL:-http://127.0.0.1:8189}"
STEPS="${STEPS:-24}"; W="${W:-768}"; H="${H:-768}"
OUT_DIR="${OUT_DIR:-$HOME/Pictures/webcam-magic}"; mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/sd-$(date +%Y%m%d-%H%M%S).png"
echo "▶ generating (${W}x${H}, ${STEPS} steps): \"$PROMPT\""
echo "  (first run after SD starts loads the model — slow; then ~20-40s)"
python3 - "$MEDIA" "$PROMPT" "$STEPS" "$W" "$H" "$OUT" "${NEG:-}" "${INIT:-}" <<'PY'
import sys, json, base64, re, urllib.request
media, prompt, steps, w, h, out, neg, init = sys.argv[1:9]
spec = {"prompt": prompt, "steps": int(steps), "w": int(w), "h": int(h)}
if neg: spec["negative"] = neg
if init:
    with open(init, "rb") as f:
        spec["init"] = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
req = urllib.request.Request(media.rstrip("/") + "/img", json.dumps(spec).encode(), {"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=360) as r:
        d = json.load(r)
except Exception as e:
    print("  ✗ request failed:", e); print("    is SD up?  ./wm.sh status   (image gen should be ✅)"); sys.exit(1)
img = d.get("image", "") if isinstance(d, dict) else ""
if not (isinstance(img, str) and img.startswith("data:image")):
    print("  ✗ no image returned:", str(d)[:200]); sys.exit(1)
open(out, "wb").write(base64.b64decode(re.sub(r'^data:image/[^;]+;base64,', '', img)))
print("  ✅ saved:", out)
PY
[ -f "$OUT" ] && command -v open >/dev/null 2>&1 && open "$OUT" && echo "  (opened in Preview)"
