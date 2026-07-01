# Webcam Magic — Refactor / Cleanup / Docs Handoff

Goal of the next session: **refactor into a clean modular structure that's easy for Claude Code to
extend, remove dead code, and write proper README + docs.** Then optionally add more capabilities
(MediaPipe & other on-device models — see Part C). Keep it **frontend-only, zero-build, GitHub-Pages**.

- **Live:** https://amsanghi.github.io/webcam-magic/  · **Repo:** github.com/amsanghi/webcam-magic (public)
- **Local:** `/Users/amansanghi/Downloads/webcam-magic` · **~97 modes** across 8 menu categories.
- Baseline conventions/gotchas also live in `HANDOFF.md` (read it too).

## A. Current state (what you're refactoring)
Static files, no build. `index.html` loads `app.js` as an ES module; it imports the rest.
- **app.js** (~700 lines) — orchestrator: model init (hand/face + lazy object/pose/segmenter), the
  render loop (30fps cap, RS backing scale), `host` object, Trystero networking (connect/reconnect/
  roles/packet/route), screen nav (lobby→menu→ready→play), MODE_INFO/MODE_ACTIONS/CAT_ORDER, all UI wiring,
  free-play `sideEffects` + `coupleEffects` + toss, eye-capture, audio analyser (level/pitch/beat/clap).
- **games.js** (~1600 lines, ~90 mode factories) — THE monster. `createGames(net, host)` closure with every
  mode + shared UI helpers (`big/scoreboard/hint/pill/outline/roundRect`) + `factories` registry. **Primary split target.**
- **gestures.js** — hand+face classification + `TUNE` thresholds. **effects.js** — particles/overlays/WebAudio.
  **share.js** — Share mode. **voice.js** — Web Speech STT. **trystero.js** — vendored P2P lib (don't touch).
- **HANDOFF.md** (baseline), **REFACTOR-HANDOFF.md** (this).

### Key conventions (must preserve through refactor)
- **3-screen flow** lobby→menu→ready→play; `navTo(screen, mode, fromNet)` syncs picks via `{t:'nav'}`.
- **Fixed sides:** player0(authority)=LEFT, player1=RIGHT on BOTH screens. `mySide=authority?0:1`. `toCanvas(pt,side)`
  maps display-normalized→canvas; both halves selfie-mirrored. Games render by ABSOLUTE player index.
- **Authority = single judge** for scored games: judges each player from that player's OWN detection, broadcasts
  score/state; non-authority `update()` returns early & renders. Roles from a STABLE `localStorage wm_pid`
  exchanged in the packet (`setRole`), NOT Trystero selfId.
- **Trystero `makeAction` returns an OBJECT** (`action.onMessage`/`action.send`), not `[send,get]`. Send on ONE
  transport only. Reconnect: `scheduleReconnect` + 12s-silence heartbeat. Keep the packet small (audio jitter otherwise).
- **`host` API** (the shared services object passed to modes): `snapshot/snapMoment/ask(non-blocking modal — NEVER
  window.prompt)/moments/voice/objects{want,labels}/pose{want,lm}/seg{want,grid,gw,gh,count}/audio{level,pitch,want}/
  videoHue()/pointer/sensors/requestSensors()/geo()`.
- **Mode contract:** factory `()=>({enter?, exit?, update(dt,local,remote), draw(ctx), onNet(m), action(a)})`.
  Adding a mode today = edit games.js `factories` + app.js `MODE_INFO`/`MODE_ACTIONS`/`CAT_ORDER` (3 places — fix this).
- **Detectors are lazy** (object/pose/segmenter load on first use via `host.<x>.want=true`); a mode sets want in
  enter(), clears in exit().
- **New gesture field** → add to `blankState()` + `classify*` in gestures.js AND to `packet()` in app.js.
- **Deploy:** a hook BLOCKS `git push` to main. Use feature branch → `gh pr create --base main` → `gh pr merge --merge`.
  Don't put `git push` and `--base main` in the same shell line. Commit msgs end with the Co-Authored-By line.
- **Env:** shell prints harmless `GVM_ROOT` noise → prefix cmds with
  `export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"`, absolute node/python. `gh` authed as `amsanghi`.
- **Headless verify:** `preview_start` → eval stub `getUserMedia`→`canvas.captureStream(10)` and
  `HTMLMediaElement.prototype.play`→resolve → click `soloBtn` → wait ~7s → inspect `#menuGrid`, check console errors.
  Real camera/mic/objects/pose/sensors/2-peer CANNOT be tested headlessly.
- **Content boundary (firm):** flirty/suggestive is fine (always-on "After dark 🌶️"); **no sexually explicit content.**

## B. Proposed refactor (target structure — no bundler needed, plain ESM)
```
index.html            → <script type=module src=./src/app.js>
/src
  app.js              → thin bootstrap: create ctx, init, wire screens, start loop
  /core
    net.js            → Trystero connect/reconnect, roles/pid, packet(), route()
    host.js           → host services (snapshot/ask/sensors/geo/pointer/moments)
    loop.js           → render loop, RS scaling, 30fps cap, draw order
    screens.js        → nav(lobby/menu/ready/play), menu builder from registry
    audio.js          → analyser: level/pitch/beat/clap
    detectors.js      → lazy MediaPipe init+step for object/pose/segmenter (hand/face stay in gestures)
  /perception
    gestures.js       → (move here) hand+face classify + TUNE
    voice.js          → (move here) Web Speech
  /fx
    effects.js        → (move here) particles/overlays/sound
  /modes
    ui.js             → big/scoreboard/hint/pill/outline/roundRect (extracted from games.js)
    lib.js            → SHARED PATTERNS: raceRound(), roundTimer(), cursor(), activeCur(), meIdx()
    registry.js       → collects {id, factory, info:{ic,nm,cat,how}, actions} from each group; exports MODE_INFO/ACTIONS/CAT_ORDER
    free.js           → free-play sideEffects + coupleEffects + toss (from app.js)
    create.js         → share*, draw, stamp, toys, stars, oursong, scrapbook
    party.js          → catch, pop, hockey, rps, dontlaugh, mirror, spinner, photobooth, synctest, thumbwar
    gestureGames.js   → target, simon, dancebattle, reaction, freeze, rhythm, poseparty, holewall, flappy, winkbattle
    senses.js         → treasure, colorhunt, note, scream, distance, tilt, shake, tapattack, typing, lovetap
    couple.js         → kisscam, mashup, lovecalc, dressup, wish, handsup
    talk.js           → q36, deeptalk, twentyq, twotruths, story, telepathy, howwell, whomore, thisorthat, hangman
    afterdark.js      → truthdare, pickup, dareroulette, loversdice, wyr, never
    singlefx.js       → the 20 "fx:<id>" single-effect entries (metadata only; run via free with soloFx)
    share.js          → Share mode (already separate)
```
Guiding principles:
1. **Pass a `ctx` object into every factory** instead of relying on closure globals. `ctx = { net, host, FX, ui,
   me:()=>meIdx(), authority:()=>isAuthority, side:()=>mySide, W,H,MID, toCanvas }`. This decouples modes from app.js
   so each mode file is self-contained and testable.
2. **Co-locate metadata with the mode.** Each mode exports `{ id, cat, ic, nm, how, actions, make }`. `registry.js`
   imports all groups and builds MODE_INFO/MODE_ACTIONS/CAT_ORDER automatically. Adding a mode = **one file, one place.**
3. **Extract the repeated "authority race" and "round/timer" patterns** into `lib.js` — ~15 games share
   `newRound → detect-first → declare(winner) → broadcast → cooldown`. This alone removes hundreds of duplicated lines.
4. Keep it **zero-build**: relative ESM imports work on GitHub Pages. Don't add webpack/vite unless you also add CI to
   build+deploy (avoid — the no-build simplicity is a feature).
5. Do the split **incrementally with a syntax-check + headless smoke test after each extraction** (all modes still
   instantiate, zero console errors) so nothing breaks silently.

### Cleanup targets (grep & confirm before deleting)
- `setAdult` is a no-op (18+ toggle removed) — remove it + the `adult` flag path (flirty is always on).
- Likely-dead in app.js: `fpsCount`/`lastFps`, `readout()`, `combo` (if only partially used), `FACE_SMILE` const,
  `sendRitual` (ritual HUD button was removed), any `frame` counter no longer needed. **grep each identifier before removing.**
- `pointPx` in games.js may be unused now (Catch/Pop switched to `cursor`). Confirm.
- Duplicate `.claude/launch.json` (one in repo root's parent `~/Downloads/.claude/`, maybe one in repo) — keep one.
- Stale comments referencing removed UI (legend/modebar/hud ids) and the "18+" deck.
- Decide fate of `HANDOFF.md`/`REFACTOR-HANDOFF.md` → move to `/docs`.
- Verify no dead net message types remain after mode moves.

### Documentation deliverables
- **README.md** — overhaul: what it is, live link, 60-sec local run (`python3 -m http.server`), deploy steps,
  input-systems table, category list, the **"How to add a mode" recipe** (the #1 thing for future dev), caveats
  (Chrome/Edge for voice, phones for sensors, no-TURN), the content boundary.
- **ARCHITECTURE.md** — module map (above), data flow diagram (camera → detectors → gestures → mode.update/draw →
  FX → canvas), the net packet shape, authority/side model, screen flow, `host`/`ctx` API reference, mode contract.
- **JSDoc header** on each module. Keep `HANDOFF.md` as the "gotchas" quick-ref.

## C. More on-device detection you can add (all frontend, no server)
### MediaPipe Tasks (same `@mediapipe/tasks-vision` / `tasks-audio` / `tasks-text`; models under storage.googleapis.com/mediapipe-models/)
Already used: HandLandmarker, FaceLandmarker (blendshapes), PoseLandmarker, ObjectDetector (EfficientDet/COCO), ImageSegmenter (selfie).
Not yet used — high value:
- **GestureRecognizer** (`gesture_recognizer/`) — robust canned hand gestures (👍👎✌️☝️✊🖐️🤟) + you can train custom
  ones. → more reliable Simon/RPS; a "learn my secret handshake" custom-gesture trainer.
- **ImageClassifier** (`image_classifier/efficientnet_lite*`) — 1000 ImageNet classes. → broader "show me a ___"
  scavenger than the ~80-class object detector; scene/room classification.
- **AudioClassifier** (`audio_classifier/yamnet`) — 521 sound classes (clap, laughter, whistle, music, dog, keys…).
  → 🔊 **Sound Charades** ("make the sound of a…"), whistle-to-win, robust laughter detection for Don't-Laugh,
  "is music playing" gate, "detect the doorbell" scavenger.
- **FaceDetector** (BlazeFace) — fast multi-face boxes. → "how many people can you fit in frame", face-count party.
- **selfie_multiclass** segmenter (`image_segmenter/selfie_multiclass`) — hair/skin/clothes/background classes. →
  recolor your hair, swap/blur background, "green-screen" dress-up, background-match game.
- **InteractiveSegmenter / HolisticLandmarker / ImageEmbedder / FaceStylizer** — niche→advanced (cartoon-face filter,
  pose-similarity to a reference photo, "find the matching object").
- **TextClassifier / TextEmbedder** (`tasks-text`) — sentiment + semantic similarity. → "sweetness score" of love
  notes; smarter Telepathy/How-Well matching (semantic, not exact-string).
- **LLM Inference** (`tasks-genai`, Gemma on-device) — generates prompts/compliments/riddles/story lines fully
  local. Powerful but the model is large (100s of MB) — probably too heavy for a casual app; note it, don't default to it.

### Other on-device options (not MediaPipe, still frontend/GitHub-Pages)
- **transformers.js (Xenova)** — run HF models in-browser via WASM/WebGPU:
  - **CLIP zero-shot image classification** → open-vocabulary "show me something *cozy / romantic / red / round*"
    (way beyond fixed classes) — arguably the coolest upgrade for scavenger/treasure games.
  - **Whisper** → offline speech-to-text that ALSO works in Safari/Firefox (Web Speech is Chrome/Edge-only).
  - sentiment / translation / image-captioning.
- **TensorFlow.js** — MoveNet (fast pose), **speech-commands** (offline wake-word / simple voice commands),
  **KNN classifier** (train custom gestures/objects live from a few examples — "teach it our inside-joke pose"),
  face-api.js (age/gender/**emotion** → an "emotion match" game).
- **Browser APIs:** `BarcodeDetector` (scan a QR/product → scavenger), `AmbientLightSensor` ("turn off the lights"),
  `Battery`, `Screen Wake Lock`, `Gamepad`, WebXR (phone AR — place a shared object in your room), `navigator.vibrate`
  (used), Web Audio tempo/pitch (used).

### Suggested "wow" additions after the refactor (ranked)
1. **CLIP scavenger** ("show me something that looks like love") — open-vocab, magical, transformers.js.
2. **Sound Charades** (YAMNet AudioClassifier) — make the animal/sound, first detected wins.
3. **GestureRecognizer** swap for reliable canned gestures + a **custom-gesture trainer** (KNN).
4. **selfie_multiclass** hair/background recolor for Dress-Up.
5. **Whisper** to make the voice games cross-browser (Safari).
6. **Emotion match** (face-api.js) couple game.

Verify each new model loads from CDN and runs before building the game around it; lazy-load per-mode like the
existing object/pose/segmenter pattern (`host.<x>.want`).
