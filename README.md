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

## Free-play gestures & expressions

**Face (section 1):** 😀 smile → sparkles · 😘 kiss → flying lips (+ fogs partner's screen) ·
😮 raised brows → shock · ☹️ frown → rain · 😉 hard blink → camera flash + 📸 · 😝 tongue →
raspberry · 😂 open-mouth laugh → screen shake · 😶 zoned-out → 💤

**One hand (section 2):** 👋 wave → glitter trail · 👈👉 finger-guns → confetti · ✌️ peace →
peace pop · 👍/👎 thumbs → +1 / boo + 🍅 · 🤟 rock-on → flames + riff · 🫰 snap → spotlight ·
👉 point → laser dot · 🤏 pinch → grab (in Toys/Draw/Stamp)

**Two hands (section 3):** 🫶 heart → flood · 🖼️ frame your face → vignette · 👏 clap →
applause · ⭕ circle → glowing orb · spread/twist → scale & rotate toys

**Couple, across the seam (section 4):** 🫶 **both** make a heart → full-screen eruption + chime ·
both smile → rainbow arc · reach to the centre together → high-five / glowing hand-hold ·
👉 point at the seam → boop your partner's nose · ambient **mood tint** (warm when you're both
happy, cool when sad) · blow a kiss → fog drifts over their screen and they wipe it away.

## Modes (top bar)

- **✨ Free** — all the passive gesture/face effects above
- **📎 Share** — the "Shacam" mode: load an **image** or **PDF**, or capture a **window/screen**, then grab/move them with a pinch, **resize/rotate with two hands**, and **swipe your palm to flip PDF pages** — all composited over your webcam. Content + transforms sync to your partner (they auto-enter Share to see it). Hit 📸 to snapshot the composite.
- **🧸 Toys** — physics objects you pinch-grab & throw; open palm = magnet; gravity toggle; drop one on your nose to wear it (section 5)
- **✏️ Draw** — pinch to paint together on a shared canvas, with a faint heart template (section 6)
- **🏷️ Stamp** — pinch to place stickers; cycle the sticker (section 6)
- **🍓 Catch / 🫧 Pop / 🏒 Hockey / ✊ RPS / 😐 Don't Laugh / 🪞 Mirror** — six mini-games (section 7)

**Extras:** 🎚 **live tuning panel** (HUD button) with sliders for every gesture/face
threshold — adjust the "feel" in real time. **Reaction weather** (sun/rain/stars by mood),
**beat-reactive** sparkle pulse from your mic, **couple streak** counter (session combo +
daily streak in `localStorage`), **cross-seam toss** (pinch-fling an emoji and it lands on
your partner's screen to catch), **head-shake** scatters toys, **concert mode** strobe on
rock-on, and a **clown filter** for the Don't-Laugh loser.

## Code layout

- `effects.js` — particle engine, screen overlays (vignette/fog/flash/rainbow/spotlight/tint/shake), WebAudio sounds
- `gestures.js` — all hand-pose & face-expression classification from MediaPipe landmarks
- `games.js` — the stateful modes (toys, draw, stamp, games)
- `app.js` — camera, models, render loop, free-play + couple effects, mode switching, Trystero networking

## Known limits (honest)

- **No TURN server** (would need hosting/paid service). ~10–20% of connections behind
  strict/symmetric NATs may fail to establish media with STUN alone. Add a TURN entry to
  the Trystero `rtcConfig` later if you hit this.
- Hand **+** face detection both run per frame (face throttled to every other frame). On
  older laptops expect 20–30fps; close other tabs for best results.
- Cross-feed effects are driven by a compact gesture packet over the data channel, so the
  partner's effects fire from their reported gesture state, not from re-detecting their video.
