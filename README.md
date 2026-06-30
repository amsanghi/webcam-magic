# ✨ Webcam Magic

A **frontend-only** two-person video call where your hands and face cast little spells —
make a heart with both hands and the screen floods with hearts, blow a kiss and it flies
across to your partner, smile and sparkles rain down.

Everything runs in the browser. **No backend, no recording** — your camera never leaves
your device. Peer-to-peer connection and signaling are fully serverless (Trystero over
public MQTT/torrent relays). STUN handles most NAT traversal.

## Stack

- **MediaPipe Tasks Vision** (WASM, on-device) — hand landmarks + face blendshapes
- **Canvas 2D** — feed compositing + particle effects
- **Trystero** (`trystero.js`, reused from WatchTogether) — serverless WebRTC rendezvous
- Pure static files — `index.html` / `style.css` / `app.js` / `trystero.js`

## Run locally

Camera APIs require a secure context, so use `localhost` (not `file://`):

```bash
cd webcam-magic
python3 -m http.server 8000
# open http://localhost:8000
```

Click **Try solo** to play alone, or type a shared secret word and **Join call** — your
partner opens the same link, types the same word, and you're connected.

## Deploy to GitHub Pages (no backend)

```bash
git init && git add . && git commit -m "Webcam Magic"
git branch -M main
git remote add origin git@github.com:<you>/webcam-magic.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / root**.
Your site goes live at `https://<you>.github.io/webcam-magic/` over HTTPS, so the camera
works for anyone. Share `https://<you>.github.io/webcam-magic/?room=yourword` to invite.

## Gestures

| Do this | Get this |
|---|---|
| 🫶 Heart with **both hands** | Hearts flood your half — if you **both** do it at once, the whole screen erupts + chime |
| 😘 Kiss / pucker | Flying kisses sail toward your partner |
| 😀 Smile | Sparkles rain around you |
| 👋 Open-hand wave | Glitter trail |
| ✌️ Peace | Peace signs pop |
| 👍 Thumbs up | Big +1 floats up |
| 😂 Open-mouth grin | Screen shakes with 😂 |

## Known limits (honest)

- **No TURN server** (would need hosting/paid service). ~10–20% of connections behind
  strict/symmetric NATs may fail to establish media with STUN alone. Add a TURN entry to
  the Trystero `rtcConfig` later if you hit this.
- Hand **+** face detection both run per frame (face throttled to every other frame). On
  older laptops expect 20–30fps; close other tabs for best results.
- Cross-feed effects are driven by a compact gesture packet over the data channel, so the
  partner's effects fire from their reported gesture state, not from re-detecting their video.
