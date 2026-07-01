# Architecture

Webcam Magic is a zero-build, frontend-only ES-module app. `index.html` loads the vendored
Trystero global and then `src/app.js` as a module; `app.js` imports everything else. No bundler,
no transpile — relative imports resolve directly in the browser and on GitHub Pages.

## Module map

```
index.html            loads src/vendor/trystero.js (global) + src/app.js (module)
src/
  app.js              bootstrap + runtime core: camera, hand/face detection, render loop,
                      free-play + couple effects, Trystero networking, screens, UI wiring
  core/
    host.js           createHost() → the shared services object (snapshots, ask, voice,
                      objects/pose/seg slots, audio, pointer, videoHue, sensors, geo)
    detectors.js      createDetectors() → lazy object / pose / segmenter detectors, stepped per frame
    audio.js          createAudio() → mic analyser: level, pitch, beat transient, clap detection
    capabilities.js   detectTier() (0 static / 1 light / 2 powerhouse) + amGenerator() election
    ai.js             createAI() → host.ai: ask()/load()/onNet()/runActions() + AI_SYS tone
    llm.js            createLLM() → main-thread manager around the worker (load state, generate)
    llm.worker.js     module worker: lazy-loads WebLLM (t2) or transformers.js (t1) from CDN
  perception/
    gestures.js       classifyHands / classifyFace from MediaPipe landmarks; blankState(); TUNE thresholds
    voice.js          createVoice() → Web Speech recognition wrapper
  fx/
    effects.js        particle engine, screen overlays (vignette/fog/flash/rainbow/spotlight/tint/
                      shake/weather), travelers, WebAudio Sound.*; exports W/H/MID/toCanvas/rnd/pick
  modes/
    context.js        live-binding runtime context: net, host, authority, meIdx + initContext/setAuthority
    ui.js             shared HUD drawing: roundRect, pill, outline, fit, hint, scoreboard, big
    lib.js            clamp, cursor, cursorPx, activeCur
    _shared.js        barrel: one import line re-exporting FX + context + ui + lib for every mode file
    registry.js       assembles MODE_INFO / MODE_ACTIONS / CAT_ORDER + factories; exports createGames()
    share.js          Share mode (image/PDF/screen capture); special factory signature
    create.js party.js gestureGames.js senses.js couple.js talk.js chill.js afterdark.js
                      the ~90 mode factories, grouped by category, each with co-located metadata
  vendor/
    trystero.js       vendored serverless-WebRTC lib (do not edit)
```

## Data flow

```
       ┌─ getUserMedia (camera + mic) ─┐
       ▼                               ▼
  localVideo                    audio analyser (core/audio.js)
       │                               │ level / pitch / beat / clap
       ▼                               ▼
  hand + face detect (app.js)   ┌──────────────┐
  → gestures.classify* → localG │  host.audio  │
       │                        └──────────────┘
       │   lazy: detectors.step{Objects,Pose,Seg} → host.{objects,pose,seg}
       ▼
  ┌────────────────── render loop (app.js, 30fps cap) ──────────────────┐
  │  draw both video halves (selfie-mirrored)                           │
  │  if free:  sideEffects(localG) + (remoteG) + coupleEffects + toss   │
  │  else:     games.update(dt, localG, remoteG) → games.draw(ctx)      │
  │  FX.step*/draw* overlays + particles + cursors                      │
  └─────────────────────────────────────────────────────────────────────┘
       │  net.send(packet())  every 100ms                 ▲
       ▼                                                  │ route()
  Trystero data channel  ───────────────────────────────►  remoteG / mode.onNet
```

Each client detects **only its own** camera. The partner's on-screen effects are driven by the
compact gesture **packet** it broadcasts, not by re-detecting the partner's video.

## The net packet

`packet()` in `app.js` sends a small, rounded JSON object ~10×/sec (`k:"g"`). Keeping it small is
critical — flooding the data channel starves the WebRTC voice/audio stream. Shape:

```
{ k:"g", pid, present, wave, fingers, handSpeed, poses,
  pinch:{active,x,y}, point:{active,x,y}, palm:{x,y}, hands:[{x,y}…],
  two:{ heart,frame,clap,cup,armsWide,prayer,handsUp,
        spread:{active,dist}, twist:{active,angle}, circle:{active,x,y,r} },
  face:{ present,smile,kiss,brow,frown,blink,tongue,laugh,wink,mouthOpen,
         tilt,zoned,headShake,nod, nose:{x,y}, mouth:{x,y} } }
```

Coordinates are display-normalized `[0..1]` within one half; inactive pinch/point drop their x/y.
Non-gesture messages (`{t:"…"}`) are routed to the active mode's `onNet` and to `handleFreeNet`.
`{t:"nav"}` mirrors screen/mode navigation to the partner.

## Authority & side model

- **Fixed sides:** player 0 (the *authority*) is LEFT on **both** screens; player 1 is RIGHT.
  `mySide = authority ? 0 : 1`. Modes render by **absolute** player index so both screens match.
- **Roles from a stable id:** each device has a persistent `wm_pid` (localStorage). On connect the
  two pids are compared (`amInitiator = myPid > theirPid`) — deterministic and identical on both
  ends. Roles are **never** derived from Trystero's `selfId` (it changes on reconnect → side-swap).
- **Authority is the single judge:** for scored games only the authority computes score (judging
  each player from *that player's own* detection) and broadcasts it; non-authority `update()`
  returns early and just renders the broadcast state. That's why both screens show identical numbers.
- `toCanvas(pt, side)` maps a display-normalized point in one half to canvas pixels. **Both halves
  are selfie-mirrored.** Logical canvas is 1280×720 (`W/H/MID`), rendered at an `RS` backing scale.

## Screen flow

`lobby → menu → ready → play`. `navTo(screen, mode, fromNet)` drives it and broadcasts `{t:"nav"}`
so one person's pick moves both. The **ready** screen shows the mode's how-to (guidelines live here,
never mid-game). `enterPlay` handles the `fx:<id>` single-effect path (runs Free with `soloFx` set).

## The mode contract

A mode factory returns an object; all methods optional except that a mode usually has `update`+`draw`:

```
() => ({
  enter(),                     // set up state; opt into detectors via host.<x>.want = true
  exit(),                      // tear down; clear host.<x>.want
  update(dt, local, remote),   // local/remote are gesture states; authority judges + net.send
  draw(ctx),                   // render into the 1280×720 logical canvas
  onNet(msg),                  // apply a peer message sent via net.send
  action(a),                   // handle an actionbar button id
})
```

### The mode context (design note)

The original handoff proposed passing an explicit `ctx` object into every factory. Instead, the
shared context is exposed as **ES-module live bindings** in `context.js` (`net`, `host`,
`authority`, `meIdx`), re-exported through `_shared.js`. `app.js` calls `initContext({net, host})`
and `setAuthority(b)` once; because module exports are live, every mode reads the current values
with a plain import and no wiring. This achieves the same decoupling (modes depend on
`context.js`, not `app.js`) while letting the ~90 factory bodies move out of the old monolith
**verbatim** — only an import line was added per file, which kept the split low-risk.

### The `host` services API

Passed to `createGames`; available to modes as `host`:

| Field | What |
| --- | --- |
| `snapshot(name)` / `snapMoment()` | download a PNG / silently save a frame to the Scrapbook |
| `ask(label, {multiline, value})` | non-blocking modal prompt — **never** `window.prompt` (it freezes the tab) |
| `voice` | Web Speech wrapper (start/stop/onResult) |
| `objects` `{want, labels}` | set `want=true` to lazy-load the object detector; `labels[]` fills each frame |
| `pose` `{want, lm}` | 33 normalized body landmarks |
| `seg` `{want, grid, gw, gh, count}` | coarse body-occupancy grid |
| `audio` `{level, pitch, want}` | loudness always; pitch when `want=true` |
| `pointer` `{x, y, t}` | last canvas tap/click in logical coords |
| `videoHue()` | dominant hue (0..360) of your video centre, or -1 |
| `sensors` `{on, beta, gamma, shake}` / `requestSensors()` | phone orientation/motion |
| `geo()` | one-shot geolocation |
| `moments` | in-memory session gallery |

## AI layer (host.ai)

Optional on-device LLM, exposed to modes as `host.ai` and wired in `app.js`.

- **Tiers** (`core/capabilities.js`): 0 static / 1 light (transformers.js + Qwen2.5-0.5B) / 2
  powerhouse (WebLLM + Llama-3.1-8B), auto-detected from WebGPU + platform + memory, with a
  `localStorage` override.
- **Generator election** (`amGenerator`): peers exchange tier via a `{t:"cap"}` message; the higher
  tier generates, ties break to the authority. The generator runs the model and the other peer
  requests text over the channel (`{t:"llm-req"}` → `{t:"llm-res"}`) and just displays it.
- **`host.ai.ask(spec, fallback)`** is the single call modes use. It resolves to a string *always* —
  generating locally, requesting from the peer, or returning the static `fallback()` deck pick. It
  never triggers a download; loading is explicit via `host.ai.load()` (a one-time cached fetch), and
  generation runs in `llm.worker.js` off the render loop.
- **Tool use** (`host.ai.runActions`): the Game Master model emits JSON actions executed via the
  `aiTools` map in `app.js` (effects, mood, banner, jump-to-game, snapshot).
- **Tone:** the system prompt (`AI_SYS` in `core/ai.js`) sets a bold/adult tone (private couple, at
  their discretion) with only the non-negotiable floor (no minors / non-consent / illegal).
- Everything is CDN ES modules + client-side model download → works on the static GitHub Pages host.

## What stayed in app.js (intentional)

The render loop, Trystero connection/reconnect/routing, screen navigation, and the free-play +
couple effects share a web of mutable runtime state (`localG`, `remoteG`, `inCall`, `mySide`,
`fxOn`, `soloFx`, fog/squish easing) that is tightly coupled to the frame loop. The cleanly
separable services (`host`, `detectors`, `audio`) were extracted; the coupled core remains in
`app.js` as the bootstrap. The 2-peer networking path cannot be exercised headlessly, so it was
left intact rather than split on faith.
