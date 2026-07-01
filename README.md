# ✨ Webcam Magic

A **frontend-only**, zero-build, two-person video call where your hands, face, body, voice,
and phone cast little spells — make a heart with both hands and the screen floods with hearts,
blow a kiss and it flies across to your partner, smile and sparkles rain down. On top of the
free-play effects there are **~97 modes** across 9 categories: games, couple activities, talk
prompts, and single-effect toys.

Built for a long-distance couple. Everything runs in the browser — **no backend, no recording,
your camera never leaves your device.** The connection is peer-to-peer and fully serverless
(Trystero over public MQTT/torrent relays; STUN for NAT traversal).

- **Live:** https://amsanghi.github.io/webcam-magic/
- **Repo:** https://github.com/amsanghi/webcam-magic

## Run locally

Camera/mic APIs need a secure context, so serve over `localhost` (not `file://`):

```bash
cd webcam-magic
python3 -m http.server 8000
# open http://localhost:8000
```

Click **Try solo** to explore alone, or type a shared secret word and **Join call** — your
partner opens the same link, types the same word, and you're connected. Invite with
`https://…/?room=yourword`.

There is **no build step.** The app is plain ES modules loaded directly by the browser; editing
a file and refreshing is the whole dev loop.

## Deploy (GitHub Pages)

Pages serves `main` at `https://<you>.github.io/webcam-magic/`. A pre-push hook blocks pushing
straight to `main`; ship through a PR:

```bash
git checkout -b my-feature
git add -A && git commit -m "…"          # end the message with the Co-Authored-By line
git push -u origin my-feature            # do NOT put "--base main" on this line (hook false-matches)
gh pr create --base main --head my-feature --title "…" --body "…"
gh pr merge my-feature --merge --delete-branch
```

Pages rebuilds in ~60–90s. See [ARCHITECTURE.md](ARCHITECTURE.md) for how the code fits together.

## Input systems

Every mode is driven by one or more of these on-device signals. All run locally; the partner's
effects are driven by a compact gesture **packet** over the data channel, not by re-detecting
their video.

| System | Source | Powers |
| --- | --- | --- |
| ✋ Hand landmarks | MediaPipe HandLandmarker (always on) | pinch/point/palm, wave, ✌️👍👎🤟🤙, two-hand heart/frame/clap/circle/spread/twist |
| 😀 Face blendshapes | MediaPipe FaceLandmarker (always on) | smile, kiss, brows, frown, blink, tongue, laugh, wink, head-shake/nod, tilt |
| 🧍 Body pose | MediaPipe PoseLandmarker (lazy) | Pose Party |
| 🕳️ Body silhouette | MediaPipe ImageSegmenter (lazy) | Hole in the Wall |
| 🔍 Objects | MediaPipe ObjectDetector (lazy) | Treasure Hunt |
| 🎤 Audio | Web Audio analyser | loudness (Scream), pitch (Match the Note), beat-reactive visuals, clap detection |
| 🗣️ Speech | Web Speech API (Chrome/Edge) | Say It First, Decipher, Pictionary guesses |
| 🎨 Video hue | canvas pixel sample | Color Hunt |
| 📱 Sensors | DeviceOrientation/Motion (phones) | Tilt Maze, Shake Race |
| 🌍 Location | Geolocation | Distance |
| ⌨️🖱️ Keyboard / pointer | DOM events | Typing Race, Tap Attack |
| 📳 Haptics | `navigator.vibrate` | Love Tap |

## Mode categories

Menu sections, in order (`CAT_ORDER` in `src/modes/registry.js`):

- **Free play** — all passive gesture/face effects at once, plus couple cross-seam moments
  (mutual heart eruption, hold-hands love-o-meter, kiss meter, pinky promise, hug, make-a-wish,
  cross-seam toss/feed-me, mood tint, beat-reactive sparkles, seasonal sprinkles).
- **Single effects 🎯** — each free-play effect playable on its own (`fx:<id>`).
- **Create** — Share (image/PDF/screen), Toys, Draw, Stamp, Our Stars, Our Song, Scrapbook.
- **Games** — Catch, Pop, Air Hockey, RPS, Don't Laugh, Mirror, Tic-Tac-Toe, Thumb War, Dance
  Battle, Sync Test, Photo Booth, Target, Simon, Keepy-Up, Reaction, Wink Duel, Charades, Freeze,
  Rhythm, Connect Four, Memory, Trivia, Vault.
- **New senses 🎙️** — Say It First, Decipher, Treasure Hunt, Distance, Tilt Maze, Shake Race,
  Pose Party, Hole in the Wall, Mouth Flappy, Color Hunt, Match the Note, Scream Meter, Typing
  Race, Tap Attack.
- **AI ✨** — Cupid (AI companion), AI Game Master (drives the app), AI Adventure, Mad Libs, and
  generative Truth-or-Dare / Would-You-Rather / Deep Talk / Date Ideas / Pet Names / Roast & Toast.
  See "On-device AI" below.
- **Couple** — Kiss Cam, Name Mash, Love Calc, Date Spinner, Pictionary, Mailbox, Bucket List,
  Dress-Up, Make a Wish, Hands Up, Love Tap.
- **Talk & connect 💬** — 36 Questions, Deep Talk, 20 Questions, Two Truths, Story Builder,
  Telepathy, How Well Do You Know Me, Who's More Likely, This or That, Hangman.
- **Chill** — Slow Dance, Mood, Breathe, Karaoke, Countdown.
- **After dark 🌶️** — Truth or Dare, Pick-up Lines, Dare Roulette, Lovers' Dice, Would You
  Rather, Never Have I Ever.

## How to add a mode

Thanks to the registry, adding a mode is a **single-file edit**. Pick the topic file matching the
category (e.g. `src/modes/party.js` for a Games mode) and:

1. **Write the factory.** A mode is a factory returning a small lifecycle object:

   ```js
   export function myGameMode() {
     let score = [0, 0];
     return {
       enter() { /* optional: reset state; set host.<detector>.want = true here */ },
       exit()  { /* optional: clear host.<detector>.want */ },
       update(dt, local, remote) { /* authority judges & broadcasts; others return early */ },
       draw(ctx) { scoreboard(ctx, score, null, "My Game 🎮"); },
       onNet(m) { /* apply a message from net.send() */ },
       action(a) { /* handle actionbar buttons */ },
     };
   }
   ```

   Shared helpers (`net`, `host`, `authority`, `meIdx`, `W/H/MID/toCanvas`, `cursor`, `big`,
   `scoreboard`, `hint`, `pill`, `outline`, the `FX` namespace, …) all come from the one-line
   `import … from "./_shared.js"` already at the top of every topic file.

2. **Register it** — add an entry to that file's `modes` object:

   ```js
   export const modes = {
     // …
     mygame: {
       cat: "Games", ic: "🎮", nm: "My Game",
       how: ["One-line how-to shown on the ready screen", "…"],
       actions: [["start", "go"]],   // optional actionbar buttons
       make: myGameMode,
     },
   };
   ```

That's it. `registry.js` picks it up automatically — it appears in the menu (`MODE_INFO`), on the
ready-screen how-to, wires its actionbar buttons (`MODE_ACTIONS`), and slots into its category.

**Multiplayer contract:** for scored games only **the authority** (player 0, left on both screens)
judges — it reads each player's own detection, computes score, and broadcasts via `net.send`;
non-authority clients `return` early from `update()` and just render the broadcast state, which is
why both screens show identical numbers. See [ARCHITECTURE.md](ARCHITECTURE.md) for the packet
shape, the authority/side model, and the full `host` API.

**Adding a new gesture:** add the field to `blankState()` and compute it in
`classifyHands`/`classifyFace` in `src/perception/gestures.js`, **and** add it to `packet()` in
`src/app.js` so the partner receives it (thresholds go in `TUNE`, live-tunable via the 🎚 panel).

## On-device AI (opt-in, still no server)

The **AI ✨** modes run a language model **in the browser** (WebGPU) — no API keys, no server,
nothing leaves your devices. It's fully compatible with the static GitHub Pages host: the engine
is an ES module from a CDN and the model weights download client-side from HuggingFace/MLC and are
then cached. Three auto-detected tiers:

| Tier | Device | Engine + model | 
| --- | --- | --- |
| **0 Static** | anything (no WebGPU / opted out) | none — hand-written fallback decks, instant, offline |
| **1 Light** | iPhone / basic laptop w/ WebGPU | transformers.js + Qwen2.5-0.5B (~400 MB) |
| **2 Powerhouse** | desktop Chrome/Edge + WebGPU + memory | WebLLM + Llama-3.1-8B (~4.6 GB) |

**Powerhouse → receiver:** the peers exchange their tier; the higher-tier device becomes the
*generator*, runs the model, and broadcasts only the resulting **text** over the existing data
channel — the other device just displays it and runs no model. So one strong laptop can serve a
partner on a phone or a basic laptop. If neither device is capable, everything falls back to the
static decks (kept in sync exactly like the other prompt games).

**Opt-in + lazy:** detecting a tier downloads nothing. The model only loads when you press **⬇ AI**
in an AI mode (one-time download, then cached); generation runs in a **Web Worker** off the render
loop. The **AI Game Master** goes further — the model emits tool-call JSON that the app executes
(fire effects, set the mood, jump into a game), turning it into a host that actually drives the
night. The tone (bold/adult, at your discretion) lives in the `AI_SYS` prompt in `core/ai.js`.

Runs great on a desktop; on iPhone keep to the light tier (Safari's WebGPU memory limit caps model
size). The static tier is always the floor, so the AI features degrade gracefully everywhere.

## Caveats (honest)

- **No TURN server** (STUN only). ~10–20% of strict/symmetric-NAT pairs may fail to establish
  media; genuine drops recover on a 12s-silence heartbeat rejoin.
- **Voice modes** (Say It, Decipher, Pictionary guessing) use the Web Speech API — **Chrome/Edge
  only**. **Sensor modes** (Tilt, Shake) need a phone with motion sensors.
- Hand + face both run per frame (face throttled to every other frame). Older laptops see
  20–30fps; the render loop is capped at 30fps deliberately (quality over framerate).
- Gesture thresholds are heuristic — tune them live on real cameras via the 🎚 panel.

## Content

This is a **private app for one couple** running a **local** model on their own devices — nothing
is sent to a server. The tone is uncensored and adult by design: the **After dark 🌶️** and
**AI ✨** modes are fully explicit-capable, at the couple's discretion. The tone lives in `AI_SYS`
in `src/core/ai.js` and is theirs to tune. The only hard floor kept in the prompt is the
non-negotiable one — nobody underage, nothing non-consensual, nothing otherwise illegal.
