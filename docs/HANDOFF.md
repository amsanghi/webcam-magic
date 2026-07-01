# Webcam Magic — Handoff

> **Note (post-refactor):** the codebase has since been modularized under `src/`
> (`core/`, `perception/`, `fx/`, `modes/`, `vendor/`) — see [../ARCHITECTURE.md](../ARCHITECTURE.md)
> for the current module map and the [README](../README.md) for the "how to add a mode" recipe.
> The **deploy / environment / headless-verify** gotchas below are still current; the file-layout
> and add-a-mode sections describe the old flat structure and are kept for history.

## What this is
A **frontend-only, no-backend** two-person **gesture + face video-call "party"** web app for a
long-distance couple (Aman & his girlfriend). Runs entirely in-browser; peer-to-peer over Trystero.
**82 "modes"** (effects, games, couple/connection activities) as of this handoff.

- **Live:** https://amsanghi.github.io/webcam-magic/  (GitHub Pages, from `main`)
- **Repo:** https://github.com/amsanghi/webcam-magic  (public)
- **Local:** `/Users/amansanghi/Downloads/webcam-magic`

## Stack & files
- **MediaPipe Tasks Vision** (hand + face landmarks/blendshapes, WASM, from jsDelivr CDN)
- **Canvas 2D** for compositing + effects; **Trystero** (`trystero.js`, vendored from the WatchTogether
  extension) for serverless P2P (mqtt + torrent). Pure static files — no build step.
- `index.html` · `style.css` · `app.js` (orchestrator) · `gestures.js` (detection + `TUNE`) ·
  `effects.js` (particles/overlays/WebAudio) · `games.js` (ALL modes) · `share.js` (Share mode) ·
  `trystero.js` (vendored) · `README.md`

## Architecture & conventions (read before editing)
- **3-screen flow:** lobby → menu → ready(guidelines) → play. `navTo(screen, mode, fromNet)` in app.js;
  it broadcasts `{t:'nav'}` so one person's choice moves both. Guidelines live on the *ready* screen, never mid-game.
- **Coordinates:** logical canvas is **1280×720** (`W,H,MID=640` exported from effects.js). Rendered at
  `RS`× backing (2–3× by devicePixelRatio; 1.5 on phones). `toCanvas(pt, side)` maps a display-normalized
  `{x,y}∈[0..1]` within one half to canvas px (uniform for both sides). **Both halves are selfie-mirrored.**
- **Fixed sides:** **player 0 (authority) = LEFT on both screens, player 1 = RIGHT.** `mySide = authority?0:1`.
  Games render by **absolute** player index so both screens are identical.
- **Authority = single judge:** for scored games, only the authority computes score (judging each player from
  *that player's own* detection) and **broadcasts** it; non-authority `update()` returns early and just renders.
  This is why both screens show identical numbers.
- **Roles from a STABLE id:** `myPid` (localStorage `wm_pid`) is exchanged in the packet; `setRole()` sets
  `amInitiator`/`mySide`. Do **not** derive roles from Trystero `selfId` (it changes on reconnect → side-swap bug).
- **Networking gotchas:**
  - This Trystero build's `makeAction("m")` returns an **OBJECT** `{ send, set onMessage }`, **not** `[send,get]`.
    Use `action.onMessage = fn` and `action.send(obj)`. (Array-destructuring throws → "stuck on connecting".)
  - Send on **one transport only** (`entries.find(e=>e.connected)`), not all (double-send stalls audio).
  - `scheduleReconnect()` retries every 3–8s; heartbeat rejoins after **12s** silence + **8s** cooldown.
  - Keep the gesture **packet small** (rounded coords, ~10/s) — data-channel flooding = **jittery voice**.
- **Text input:** ALWAYS use `host.ask(label, {multiline, value})` (non-blocking modal). **Never `window.prompt`**
  — it freezes the tab, stops packets, and the partner reconnects/hangs.
- **Adding a mode:** write a factory in `games.js` returning `{enter?, exit?, update(dt,local,remote), draw(ctx),
  onNet(m), action(a)}`; register it in the `factories` object; add a `MODE_INFO[id] = {ic,nm,cat,how[]}` and
  (if it has buttons) `MODE_ACTIONS[id]` in app.js. Menu auto-builds from `MODE_INFO`; `CAT_ORDER` sets sections.
  Use shared helpers `big/scoreboard/hint/pill/outline` for readable text; `FX.*` for effects; `cursor(g)` /
  `activeCur(local,remote,turn)` for pointer input; `meIdx()` for "you vs partner".
- **Adding a gesture:** add the field to `blankState()` + compute it in `classifyHands`/`classifyFace` in
  gestures.js, AND add it to `packet()` in app.js so the partner receives it. Thresholds go in `TUNE` (live-tunable
  via the 🎚 panel).
- **Global feature:** close-eyes-to-snap (hold ~0.4s, fires ~0.25s after reopen) → silent capture to Scrapbook
  (`host.moments` in memory + a localStorage thumbnail); 👁 toggle persisted in localStorage.

## Deploy workflow (IMPORTANT)
A pre-commit/push **hook blocks direct `git push` to main.** Ship via:
```
git checkout -b my-feature
git add -A && git commit -m "..."            # end message with the Co-Authored-By line
git push -u origin my-feature                # do NOT put "--base main" in the same command line (hook false-matches)
gh pr create --base main --head my-feature --title "..." --body "..."
gh pr merge my-feature --merge --delete-branch
git checkout main && git fetch origin && git merge --ff-only origin/main
```
Pages rebuilds from `main` in ~60–90s. Verify live: `gh api repos/amsanghi/webcam-magic/pages/builds/latest --jq .status`
then curl the files with a `?x=timestamp` cache-buster.

## Environment quirks
- The shell prints `ERROR: GVM_ROOT not set` — **harmless noise**. Prefix commands with
  `export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"` and use absolute paths (node/python at
  `/opt/homebrew/bin`). `gh` is authed as `amsanghi`.

## How to verify without a camera (headless preview)
`.claude/launch.json` (at `~/Downloads/.claude/`) runs `python3 -m http.server 8123 --directory webcam-magic`.
Use the Preview MCP tools: `preview_start` → in `preview_eval` stub the camera:
```
const cv=document.createElement('canvas');cv.width=320;cv.height=180;
navigator.mediaDevices.getUserMedia=async()=>cv.captureStream(10);
HTMLMediaElement.prototype.play=function(){return Promise.resolve()};
document.getElementById('soloBtn').click();
```
Wait ~7s for MediaPipe to load, then inspect `#menuGrid` / click cards / check `preview_console_logs level:error`.
**Real gestures and 2-peer sync can't be tested headlessly** — only load/instantiation + no-console-errors.

## Known limitations
- **No TURN server** (STUN only) → ~10–20% of strict-NAT pairs may fail to connect; real drops recover on the 12s heartbeat.
- **Gesture thresholds are heuristic** — tune on real cameras via the 🎚 panel (`TUNE` in gestures.js).
- **Mobile:** video no longer stretches and fits both orientations, but portrait is **letterboxed side-by-side, not
  stacked vertically** (true vertical relayout needs parameterizing the whole 1280×720 coordinate system — not done).
- **Content boundary (firm):** flirty/suggestive/innuendo is fine and always on ("After dark 🌶️" category), but
  **no sexually explicit content / nudity** — this line was held throughout at the assistant's insistence; keep it.
- 2-player games need **both in the same mode** (nav syncs the pick; Share auto-switches the partner).

## Mode categories (in `CAT_ORDER`)
Free play · Single effects 🎯 (20 one-effect games) · Create (share/draw/stamp/toys/stars/oursong/scrapbook) ·
Games (catch/pop/hockey/rps/dontlaugh/mirror/tictactoe/thumbwar/dancebattle/synctest/photobooth/target/simon/
balloon/reaction/winkbattle/charades/freeze/rhythm/connect4/memory/trivia/vault) · Couple (kisscam/mashup/lovecalc/
spinner/pictionary/mailbox/bucket/dressup/wish/handsup) · Talk & connect 💬 (36 questions/deeptalk/20q/twotruths/
story/telepathy/howwell/whomore/thisorthat/hangman) · Chill (slowdance/mood/breathing/karaoke/countdown) ·
After dark 🌶️ (truthdare/pickup/dareroulette/loversdice/wyr/never).

## Suggested next steps (unbuilt ideas)
Battleship · Dots & Boxes · Spot the Difference · co-op maze/escape · finish-the-lyric · synced meditation ·
reunion countdown calendar · drawing-telephone · daily-streak rituals · **true portrait vertical-stack layout** ·
**TURN server** for reliability · "download all" for the Scrapbook · gesture threshold tuning after real play.
