// app.js — orchestrator: camera, MediaPipe, render loop, free-play effects,
// couple cross-feed effects, mode/game switching, and Trystero networking.
import { HandLandmarker, FaceLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import * as FX from "./fx/effects.js";
import * as G from "./perception/gestures.js";
import { createGames, MODE_INFO, MODE_ACTIONS, CAT_ORDER } from "./modes/registry.js";
import { setAiGameSpec } from "./modes/ai.js";
import { createVoice } from "./perception/voice.js";
import { createHost } from "./core/host.js";
import { createDetectors } from "./core/detectors.js";
import { createAudio } from "./core/audio.js";
import { createAI, AI_SYS, TOOL_DOC } from "./core/ai.js";
import { createChat } from "./core/chat.js";
import { ICON, hydrateIcons } from "./core/icons.js";
import { hudReset, hudState } from "./modes/ui.js";
import { modeIcon } from "./core/modeIcons.js";
import { createDirector } from "./core/director.js";
import { createMemory } from "./core/memory.js";
const VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const HAND_MODEL  = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL  = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const { W, H, MID, toCanvas } = FX;
const $ = (id) => document.getElementById(id);
const canvas = $("canvas"), ctx = canvas.getContext("2d");
const localVideo = $("localVideo"), remoteVideo = $("remoteVideo");
hydrateIcons();                    // swap <i data-ic="…"> placeholders for inline SVG
// action-bar buttons: strip the leading emoji from mode action labels, prefix a clean icon
const ACT_ICON = { go: ICON.sparkles, next: ICON.arrowRight, prev: ICON.arrowLeft, begin: ICON.play, start: ICON.play, load: ICON.download, ai: ICON.sparkles, ask: ICON.plus, add: ICON.plus, swap: ICON.refresh, reset: ICON.refresh, reveal: ICON.eye, enter: ICON.pencil, words: ICON.pencil, write: ICON.pencil, set: ICON.pencil, answer: ICON.pencil, word: ICON.pencil, guess: ICON.search, clear: ICON.x, remove: ICON.x, spin: ICON.refresh, roll: ICON.refresh, shoot: ICON.camera, tap: ICON.heartFill, calc: ICON.heartFill, lyrics: ICON.chat, enable: ICON.download, "new": ICON.plus };

// Render at higher-than-logical resolution so the feed isn't upscaled/blurry.
// Drawing math stays in the logical 1280x720 space; the context is scaled by RS,
// so the canvas backing store is RS× sharper (e.g. 2560x1440 on a retina screen).
const RS = Math.min(window.innerWidth, window.innerHeight) < 820
  ? 1.5                                                    // lighter on phones so audio/video stay smooth
  : Math.min(3, Math.max(2, window.devicePixelRatio || 1));
canvas.width = Math.round(W * RS); canvas.height = Math.round(H * RS);
ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
canvas.addEventListener("pointerdown", (e) => { const r = canvas.getBoundingClientRect(); host.pointer = { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H, t: performance.now() }; bumpInteract(); });

// 📱 STACKED VIEW (portrait phones): all logic + drawing stay in the 1280x720
// side-by-side space; at display time the two halves are re-composited
// vertically (player 0 on top) onto this second canvas, which nearly fills a
// phone screen (640x1440 ≈ 9:20). Modes whose OUTPUT is a shared full-width
// drawing (boards, meters, lyrics, centered canvas text) opt out via NO_STACK
// and keep the classic view. Taps are inverse-mapped back to logical coords.
const stackCanvas = document.createElement("canvas");
stackCanvas.id = "stackCanvas"; stackCanvas.className = "hidden";
stackCanvas.width = Math.round(MID * RS); stackCanvas.height = Math.round(H * 2 * RS);
document.getElementById("stage").appendChild(stackCanvas);
const sctx = stackCanvas.getContext("2d");
stackCanvas.addEventListener("pointerdown", (e) => {
  const r = stackCanvas.getBoundingClientRect();
  const xN = (e.clientX - r.left) / r.width;
  const yL = (e.clientY - r.top) / r.height * (H * 2);
  const bottom = yL >= H;                       // top panel = left half, bottom = right half
  host.pointer = { x: (bottom ? MID : 0) + xN * MID, y: bottom ? yL - H : yL, t: performance.now() };
  bumpInteract();
});

let handLM = null, faceLM = null;
let inCall = false, fxOn = true, amInitiator = true, haveRemoteVideo = false, playing = false;
let mySide = 0;                 // fixed: player 0 (authority) = left on BOTH screens, player 1 = right
let soloFx = null;              // when set, Free play runs only this one feature
let eyeCapOn = true; try { eyeCapOn = localStorage.getItem("wm_eyecap") !== "0"; } catch (_) {}   // default ON, remembered
// 🎨 webcam look — a cheap canvas filter to make laptop cams pop (opt-out, remembered)
const ENHANCE = { off: "none", natural: "contrast(1.06) saturate(1.12) brightness(1.03)", vivid: "contrast(1.14) saturate(1.3) brightness(1.05)", sharp: "url(#wm-sharpen) contrast(1.08) saturate(1.16) brightness(1.04)" };
const ENH_ORDER = ["natural", "vivid", "sharp", "off"], ENH_LABEL = { off: "Off", natural: "Natural", vivid: "Vivid", sharp: "Sharp" };
let enhanceLevel = "natural"; try { const v = localStorage.getItem("wm_enh"); if (v && ENHANCE[v]) enhanceLevel = v; } catch (_) {}
let eyeClosedT = 0, eyeArmed = false, eyeReopen = -1, snapCount = 0;   // "close eyes to snap"
let frame = 0, lastVideoTime = -1;
let combo = 0;
let sessionStartT = performance.now(), lastInteractT = performance.now();   // for the Director's lull/arc sense
const bumpInteract = () => { lastInteractT = performance.now(); };

let localG = G.blankState(), remoteG = G.blankState();

// ---- networking handle passed into games ----------------------------------
const net = { send: (o) => { if (sendMsg) sendMsg(o); } };
let sendMsg = null;
const host = createHost(canvas, localVideo);
host.localVideo = localVideo; host.remoteVideo = remoteVideo;   // raw feeds for modes that composite video (Cuddle Cam)
const games = createGames(net, host);
const { stepObjects, stepPose, stepSeg } = createDetectors(host, localVideo);
const audio = createAudio(host, () => games.mode === "free" && fxOn);

// ---- AI layer (host.ai): tiered on-device LLM + powerhouse→receiver broadcast.
// `aiTools` is Cupid's vocabulary (emitted as JSON actions from chat, the director's
// host beats, and the Game Master mode). `aiToolsLocal` holds the pure local effect;
// the tools in AI_SHARED are wrapped to also broadcast `{t:"ai-act"}` so Cupid's
// moves land on BOTH screens, not just the device that generated them.
// Cupid speaking is the same: aiSay() shows the line here AND mirrors it across.
function aiSay(text) { if (!text) return; if (host.chat) host.chat.say("ai", text); net.send({ t: "chat", who: "ai", text }); }
const aiToolsLocal = {
  effect: (n) => { const map = { confetti: () => fireConfetti(), hearts: () => FX.flood(0, W, ["❤️", "💖", "💕"], 60, true), rainbow: () => FX.triggerRainbow(), sparkle: () => FX.confetti(W / 2, H * 0.4, 20), shake: () => FX.addShake(0.5) }; (map[n] || map.sparkle)(); },
  mood: (t) => { const map = { candlelight: () => { FX.setWeather("stars", 0.5); FX.setTint(255, 150, 120, 0.18); }, party: () => { FX.triggerRainbow(); FX.setWeather("stars", 0.6); }, cozy: () => FX.setTint(255, 170, 140, 0.15) }; (map[t] || map.cozy)(); },
  weather: (t) => { const m = { sun: ["sun", 0.7], rain: ["rain", 0.6], stars: ["stars", 0.6] }; const w = m[t] || m.stars; FX.setWeather(w[0], w[1]); },
  banner: (txt) => FX.banner(W / 2, H * 0.3, String(txt || "").slice(0, 60)),
  award: (a) => { const title = String((a && a.title) || a || "champion").slice(0, 50); FX.banner(W / 2, H * 0.3, "🏆 " + title); FX.confetti(MID * 0.5, H * 0.4, 18); FX.confetti(MID * 1.5, H * 0.4, 18); FX.Sound.chime(); },
  game: (id) => { if (MODE_INFO[id]) navTo("play", id); },
  menu: () => navTo("menu"),
  snap: () => host.snapMoment(),
  enhance: (lvl) => { if (ENHANCE[lvl]) { enhanceLevel = lvl; try { localStorage.setItem("wm_enh", lvl); } catch (_) {} reflectEnhance(); } },
  sweet: () => sendSweet(),
  confetti: () => fireConfetti(),
  say: (txt) => { if (txt) aiSay(String(txt)); },
  ask: (q) => { if (host.chat && q) return host.chat.ask(String(q)); },
  // a fact worth keeping → straight into the couple's long-term memory
  remember: (t) => { if (t && host.memory) host.memory.note("note", String(t)); },
  // 🎲 Cupid invents a game: stash + share the spec, then jump both screens into
  // the generic runtime (modes/ai.js aiGameMode validates and referees it).
  spawnGame: (spec) => { if (spec && typeof spec === "object") { setAiGameSpec(spec); net.send({ t: "aig", spec }); } navTo("play", "aigame"); },
  // 🤫 the whisper channel: a private line only ONE partner sees. `to` is the
  // absolute player index (0 = left/authority, 1 = right) — self-routing, so it
  // works no matter which device ran the action.
  whisper: (a) => {
    const text = String((a && a.text) || (typeof a === "string" ? a : "") || "").slice(0, 200); if (!text) return;
    const to = a && a.to != null ? (a.to | 0) : 1 - mySide;
    if (to === mySide) { if (host.chat && host.chat.whisper) host.chat.whisper(text); }
    else net.send({ t: "whisper", text });
  },
  // 🖼 conjure a picture via the home image server → Scrapbook + shared to partner
  image: (prompt) => {
    if (!host.ai || !host.ai.canImage) { if (host.chat) host.chat.say("ai", "(turn on the home image server to make pictures ✨ — see server/media)"); return; }
    if (host.chat) host.chat.say("ai", "✨ painting something for you…");
    host.ai.image({ prompt: String(prompt || "a dreamy romantic scene for a couple, cinematic"), w: 768, h: 512, steps: 26 }, () => null).then((url) => {
      if (!url) return;
      if (host.moments) host.moments.push({ url }); net.send({ t: "portrait", url });
      FX.banner(W / 2, H * 0.3, "🖼 new picture!"); if (host.chat) host.chat.say("ai", "made you a picture — it's in your Scrapbook 📔");
    });
  },
};
const AI_SHARED = ["effect", "mood", "weather", "banner", "award"];
const aiTools = Object.assign({}, aiToolsLocal);
for (const k of AI_SHARED) aiTools[k] = (arg) => { aiToolsLocal[k](arg); net.send({ t: "ai-act", a: k, arg }); };
const ai = createAI({ net, getAuthority: () => amInitiator, tools: aiTools });
host.ai = ai;
// console helper to point the app at your home AI server (see server/README.md):
//   wmAI.configure("https://your-tunnel-url")   — then it becomes the top tier.
window.wmAI = ai;

// ---- couple memory: names, moments, and end-of-night recaps. Persists locally and
// syncs a compact snapshot to the partner, so both devices "remember" the same night.
// onChange keeps the AI's personalization/tone current and (throttled) shares to peer.
let memSyncT = 0;
const memory = createMemory({
  onChange: (sync) => {
    if (memory.profile.a) ai.setProfile(memory.profile.a, memory.profile.b);
    if (ai.setTone && memory.spice != null) ai.setTone(Math.min(2, memory.spice));
    if (sync !== false && inCall) { const t = performance.now(); if (t - memSyncT > 2500) { memSyncT = t; net.send({ t: "mem", snap: memory.snapshot() }); } }
  },
});
host.memory = memory;
window.wmMemory = memory;
if (memory.profile.a) ai.setProfile(memory.profile.a, memory.profile.b);
if (ai.setTone && memory.spice != null) ai.setTone(Math.min(2, memory.spice));

// ---- chat dock: inline input (replaces the old modal) + AI companion + voice.
// Typing in ANY mode: if the mode handles it (games.onChat) use that, else it's
// a message to the AI companion (Cupid) — available everywhere out of the box.
const CHAT_FB = ["mm, tell me more 😏", "you two are trouble 💕", "I like where this is going…", "ask me for a dare 😈", "load the AI (⬇) and I'll actually think 🧠"];
function defaultChat(text) {
  net.send({ t: "chat", who: "partner", text });                 // partner sees my message
  if (host.chat.thinking) host.chat.thinking(true);
  // Tool-aware: Cupid can answer AND act (effects, mood, whispers, game switches,
  // pictures…) — any trailing JSON block is executed and stripped from the bubble.
  host.ai.ask({ system: AI_SYS + TOOL_DOC + (host.memory ? host.memory.forPrompt() : ""), user: text, max: 200 }, () => FX.pick(CHAT_FB)).then((r) => {
    if (host.chat.thinking) host.chat.thinking(false);
    if (r) {
      const acted = host.ai.runActions(r);
      let show = r.replace(/\{[\s\S]*\}\s*$/, "").trim();
      if (!show && acted) show = acted.say;
      if (show) aiSay(show);
    }
    if (host.director) host.director.afterChat(text);
  });
}
const chat = createChat({
  voice: host.voice,
  onSend: (t) => { bumpInteract(); if (!games.onChat(t)) defaultChat(t); },
  serverTts: (t) => (host.ai && host.ai.tts ? host.ai.tts(t) : Promise.resolve(null)),   // neural voice → falls back to browser TTS
  serverStt: (b) => (host.ai && host.ai.stt ? host.ai.stt(b) : Promise.resolve(null)),   // Whisper for mic where Web Speech is absent
});
host.chat = chat;
host.ask = chat.ask;      // inline dock input replaces the blocking modal

// ---- AI Director: the host that runs the show (proactive + agentic) -------
const director = createDirector({
  ai, chat, tools: aiTools, say: aiSay,
  nav: (screen, mode) => navTo(screen, mode),
  modeAction: (a) => games.action(a),
  getMode: () => games.mode,
  getModeActions: (id) => MODE_ACTIONS[id],
  getModeInfo: (id) => MODE_INFO[id],
  modeIcon,
  isAuthority: () => amInitiator,
  memory, getRoom: roomState, grabFrame: (m, q) => host.grabFrame(m, q),
});
host.director = director;
window.wmDirector = director;      // console/debug handle (see window.wmAI)
window.wmHost = host;              // debug handle: inspect pointer/sensors/detectors live

// =====================================================================
//  LOCAL DETECTION
// =====================================================================
function detectLocal(dt) {
  if (!handLM || localVideo.readyState < 2 || localVideo.currentTime === lastVideoTime) return;
  lastVideoTime = localVideo.currentTime;
  const ts = performance.now();
  const hr = handLM.detectForVideo(localVideo, ts);
  G.classifyHands(hr.landmarks, localG);
  if (faceLM && frame % 2 === 0) {
    const fr = faceLM.detectForVideo(localVideo, ts + 0.5);
    G.classifyFace(fr.faceBlendshapes && fr.faceBlendshapes[0], fr.faceLandmarks && fr.faceLandmarks[0], localG, dt * 2);
  }
}

// =====================================================================
//  FREE-PLAY EFFECTS  (sections 1, 2, 3 per side + 4 couple + 8 ambient)
// =====================================================================
const edges = {};
function edge(key, cond, fn) { if (cond && !edges[key]) fn(); edges[key] = cond; }
const squishTarget = [0, 0];

function sideEffects(g, side, dt) {
  if (!fxOn) return;
  const T = G.TUNE, F = g.face || {}, P = g.poses || {};
  const at = (pt) => toCanvas(pt, side);
  const halfX = side * MID + MID * 0.5;
  const ok = (id) => !soloFx || soloFx === id;          // single-feature filter

  // ---- held toggles (each forced OFF when filtered out) ----
  FX.setVignette(side, !!g.two.frame && ok("frame"));
  FX.setSpotlight(side, P.snap && g.palm && ok("snap") ? g.palm : null);
  FX.setConcert(side, P.rockOn && ok("rockon"));

  // 🤏 cheek-squish
  let squishing = false;
  if (ok("squish") && F.nose && g.hands && g.hands.length >= 2) {
    squishing = g.hands.filter((h) => Math.abs(h.x - F.nose.x) < 0.28 && h.y > F.nose.y - 0.18 && h.y < F.nose.y + 0.25).length >= 2;
  }
  squishTarget[side] = squishing ? 1 : 0;
  edge("squish" + side, squishing, () => { FX.banner(halfX, H * 0.22, "squiish~ 😆"); FX.Sound.boing(); FX.burst(halfX, H * 0.4, ["😆", "💕"], 6, 160); });

  // ---- continuous ----
  if (ok("smile") && F.smile > T.smile) {
    if (Math.random() < F.smile) FX.sparkleAt(halfX + FX.rnd(-120, 120), FX.rnd(40, H * 0.55), 1);
    if (F.smile > 0.85 && Math.random() < 0.3) FX.confetti(halfX, H * 0.3, 6);
  }
  if (ok("wave") && g.wave && g.palm) { const p = at(g.palm); FX.sparkleAt(p.x, p.y, 2); }
  if (ok("rockon") && P.rockOn) for (const h of g.hands) { const p = at(h); FX.emoji(p.x, p.y, FX.rnd(-40, 40), -FX.rnd(120, 240), "🔥", FX.rnd(26, 40), 0.7, 200); }
  if (ok("frown") && F.frown > T.frown - 0.1 && Math.random() < 0.4) { const cx = F.nose ? at(F.nose).x : halfX; FX.emoji(cx + FX.rnd(-70, 70), H * 0.2, 0, FX.rnd(140, 220), "💧", 22, 1.5, 320); }

  // ---- edge bursts: face ----
  if (ok("kiss")) edge("kiss" + side, F.kiss > T.kiss, () => {
    const src = F.mouth ? at(F.mouth) : { x: halfX, y: H * 0.4 };
    FX.spray(src.x, src.y, side === 0 ? 1 : -1, ["💋", "😘", "💗", "💕"], 10);
    if (inCall) {
      const oSide = 1 - side, oG = (g === localG) ? remoteG : localG;
      FX.travel(src, () => oG.face.nose ? toCanvas(oG.face.nose, oSide) : { x: oSide * MID + MID / 2, y: H * 0.4 }, "💋",
        (d) => { FX.blush(d.x, d.y); FX.burst(d.x, d.y, ["💗", "💕"], 6, 160); FX.Sound.pop(); });
      if (g === localG) { net.send({ t: "fog" }); bumpStreak(); }
    }
  });
  if (ok("brow")) edge("brow" + side, F.brow > T.brow, () => { const p = F.nose ? at(F.nose) : { x: halfX, y: H * .35 }; FX.burst(p.x, p.y - 60, ["😮", "❗"], 8, 240); });
  if (ok("blink")) edge("blink" + side, F.blink > T.blink, () => { FX.flash(); FX.emoji(side === 0 ? 40 : W - 40, 60, 0, 0, "📸", 60, 2.2, 30); });
  if (ok("tongue")) edge("tongue" + side, F.tongue > T.tongue, () => { FX.burst(F.mouth ? at(F.mouth).x : halfX, H * 0.42, ["😜", "🤪"], 8, 220); FX.Sound.raspberry(); });
  if (ok("laugh")) edge("laugh" + side, !!F.laugh, () => { FX.burst(halfX, H * 0.42, ["😂"], 14, 360); FX.balloons(halfX, 6); FX.addShake(0.4); });
  if (ok("frown")) edge("frownS" + side, F.frown > T.frown, () => FX.Sound.sad());
  if (ok("zoned")) edge("zoned" + side, !!F.zoned, () => { FX.emoji(halfX, H * 0.35, FX.rnd(-20, 20), -120, "💤", 44, 2.4, 60); FX.Sound.sad(); });

  // ---- edge bursts: one hand ----
  if (ok("guns")) edge("guns" + side, P.fingerGuns, () => { const p = g.point.active ? at(g.point) : { x: halfX, y: H * .4 }; FX.confetti(p.x, p.y, 16); FX.Sound.snap(); });
  if (ok("peace")) edge("peace" + side, P.peace, () => { for (let i = 0; i < 10; i++) FX.emoji(halfX + FX.rnd(-MID / 2 + 40, MID / 2 - 40), -FX.rnd(0, 120), FX.rnd(-30, 30), FX.rnd(120, 200), "✌️", FX.rnd(26, 40), FX.rnd(2, 3), 200); });
  if (ok("thumbsup")) edge("thumbUp" + side, P.thumbsUp, () => FX.plusOne(halfX, H * 0.7, "👍"));
  if (ok("thumbsdown")) edge("thumbDn" + side, P.thumbsDown, () => { FX.plusOne(halfX, H * 0.7, "👎"); FX.burst(halfX, H * 0.5, ["🍅"], 8, 240); FX.Sound.boo(); });
  if (ok("rockon")) edge("rock" + side, P.rockOn, () => FX.Sound.riff());
  if (ok("wave")) edge("wave" + side, g.wave, () => FX.banner(halfX, H * 0.22, "hi! 👋"));

  // ---- edge bursts: two hands ----
  if (ok("clap")) edge("clap" + side, g.two.clap, () => { FX.burst(halfX, H * 0.45, ["👏"], 12, 300); FX.Sound.applause(); });
  if (ok("circle")) edge("circle" + side, g.two.circle.active, () => {
    const p = at({ x: g.two.circle.x, y: g.two.circle.y });
    FX.ring(p.x, p.y, "#9b6bff"); FX.burst(p.x, p.y, ["🔮", "✨"], 8, 180);
  });
}

function drawFreeOverlay(ctx) {
  for (const [g, side] of [[localG, mySide], [inCall ? remoteG : null, 1 - mySide]]) {
    if (!g) continue;
    // laser pointer (section 2: point)
    if ((!soloFx || soloFx === "point") && g.point && g.point.active) {
      const p = toCanvas(g.point, side);
      ctx.save(); ctx.shadowColor = "#ff3b3b"; ctx.shadowBlur = 16; ctx.fillStyle = "#ff3b3b";
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill(); ctx.restore();
    }
    // frown rain cloud parked over the head (section 1)
    if ((!soloFx || soloFx === "frown") && g.face && g.face.frown > G.TUNE.frown && g.face.nose) {
      const n = toCanvas(g.face.nose, side);
      ctx.save(); ctx.font = "70px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🌧️", n.x, n.y - 150); ctx.restore();
    }
  }
  tossDraw(ctx);
  // love-o-meter bar (section 4)
  if (inCall && loveMeter > 0.02) {
    const w = 220, x = W / 2 - w / 2, y = 74;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(x - 4, y - 4, w + 8, 16);
    ctx.fillStyle = "#ff5c8a"; ctx.fillRect(x, y, w * loveMeter, 8);
    ctx.fillStyle = "#fff"; ctx.font = "13px system-ui"; ctx.textAlign = "center";
    ctx.fillText("❤️‍🔥 love-o-meter " + Math.round(loveMeter * 100) + "%", W / 2, y - 8);
    ctx.restore();
  }
}

// ---- cross-seam toss / pinch-fling (sections 2 & 4) -----------------------
const throws = [];                 // {x,y,vx,vy,ch,s}
let heldThrow = null, heldPrev = null;
function tossSpawn(x, y, ch) { if (throws.length < 12) throws.push({ x, y, vx: 0, vy: 0, ch, s: 46 }); return throws.length - 1; }
function tossUpdate(dt) {
  const pinching = localG.pinch && localG.pinch.active;
  const p = pinching ? toCanvas(localG.pinch, mySide) : null;
  if (pinching && p) {
    if (heldThrow == null) {
      let best = -1, bd = 70; throws.forEach((o, i) => { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < bd) { bd = d; best = i; } });
      heldThrow = best >= 0 ? best : tossSpawn(p.x, p.y, "💖");
    }
    const o = throws[heldThrow];
    if (o) { o.vx = heldPrev ? (p.x - heldPrev.x) / dt : 0; o.vy = heldPrev ? (p.y - heldPrev.y) / dt : 0; o.x = p.x; o.y = p.y; }
    heldPrev = p;
  } else { heldThrow = null; heldPrev = null; }
  const myMouth = localG.face && localG.face.mouth ? toCanvas(localG.face.mouth, mySide) : null;
  for (let i = throws.length - 1; i >= 0; i--) {
    const o = throws[i]; if (i === heldThrow) continue;
    o.vy += 700 * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.vx *= 0.995;
    if (o.y > H - o.s / 2) { o.y = H - o.s / 2; o.vy *= -0.5; o.vx *= 0.8; }
    if (o.x < o.s / 2) { o.x = o.s / 2; o.vx *= -0.6; }
    if (o.x > W - o.s / 2) { o.x = W - o.s / 2; o.vx *= -0.6; }
    // 🍰 feed-me: an incoming throwable that reaches your mouth gets "eaten"
    if (myMouth && Math.hypot(o.x - myMouth.x, o.y - myMouth.y) < 55) { FX.burst(myMouth.x, myMouth.y, ["😋", "💕"], 8, 180); FX.Sound.pop(); throws.splice(i, 1); continue; }
    // hand off to partner when it crosses the seam away from my side
    if (inCall && (mySide === 0 ? o.x > MID : o.x < MID)) { net.send({ t: "toss", yN: o.y / H, ch: o.ch }); throws.splice(i, 1); continue; }
  }
}
function tossDraw(ctx) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  for (const o of throws) { ctx.save(); ctx.font = `${o.s}px serif`; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.strokeText(o.ch, o.x, o.y); ctx.fillStyle = "#fff"; ctx.fillText(o.ch, o.x, o.y); ctx.restore(); }
}

// couple cross-feed effects (section 4)
function coupleEffects(dt) {
  if (!inCall) return;
  // mutual heart -> eruption
  edge("mutualHeart", localG.two.heart && remoteG.two.heart, () => {
    FX.flood(0, W, ["❤️", "💖", "💕", "💗", "💞", "🩷"], 120, true);
    FX.burst(W / 2, H / 2, ["❤️", "💖", "💕"], 40, 520); FX.addShake(0.5); FX.Sound.chime();
    bumpStreak(true); bumpInteract(); if (host.memory) host.memory.note("moment", "made a heart together ❤️");
  });
  // synchronized smile -> rainbow
  edge("syncSmile", localG.face.smile > G.TUNE.smile + 0.05 && remoteG.face.smile > G.TUNE.smile + 0.05, () => { FX.triggerRainbow(); FX.Sound.chime(); });

  // hands meeting at the seam: high-five (edge) + hold-hands link (held) + love-o-meter
  const lHand = nearSeam(localG, 0), rHand = nearSeam(remoteG, 1);
  const meeting = lHand && rHand && Math.abs(lHand.y - rHand.y) < 0.22;
  edge("highfive", meeting, () => { FX.burst(MID, ((lHand.y + rHand.y) / 2) * H, ["🙌", "✋", "✨"], 16, 360); FX.addShake(0.3); FX.Sound.pop(); });
  if (meeting) {
    FX.link(MID - 4, lHand.y * H, MID + 4, rHand.y * H);
    loveMeter = Math.min(1, loveMeter + dt * 0.22);
    if (loveMeter >= 1 && !loveMaxed) { loveMaxed = true; FX.flood(0, W, ["💖", "🎆", "✨", "💞"], 90, true); FX.burst(W / 2, H / 2, ["🎆", "💖"], 40, 520); FX.Sound.chime(); FX.banner(W / 2, H * 0.4, "soulmates 💞"); if (host.memory) host.memory.note("moment", "maxed the love-o-meter 💞"); }
  } else { loveMeter = Math.max(0, loveMeter - dt * 0.12); if (loveMeter <= 0) loveMaxed = false; }

  // 💋 kiss meter — both pucker at once
  edge("mutualKiss", localG.face.kiss > G.TUNE.kiss && remoteG.face.kiss > G.TUNE.kiss, () => {
    FX.burst(MID, H * 0.4, ["💋", "❤️", "💕", "💗"], 26, 420); FX.addShake(0.25); FX.Sound.chime();
    kissesToday = bumpDaily("wm_kiss"); FX.banner(MID, H * 0.32, `💋 kiss #${kissesToday}`); bumpInteract(); if (host.memory) host.memory.note("moment", "shared a kiss 💋");
  });
  // 🤙 pinky promise — both make a pinky
  edge("pinky", localG.poses.pinky && remoteG.poses.pinky, () => { FX.link(MID - 30, H * 0.45, MID + 30, H * 0.45); FX.burst(MID, H * 0.45, ["🤙", "✨"], 10, 200); FX.banner(MID, H * 0.34, "pinky promise 🤙"); FX.Sound.chime(); });
  // 🫂 send a hug — both open arms wide
  edge("hug", localG.two.armsWide && remoteG.two.armsWide, () => { FX.emoji(MID, H / 2, 0, 0, "🫂", 220, 1.8, 0); FX.flood(0, W, ["💗", "💓"], 30); FX.setTint(255, 150, 180, 0.25); FX.banner(W / 2, H * 0.3, "big hug 🫂"); FX.Sound.chime(); });
  // 🌠 make a wish — both close eyes together
  edge("wish", localG.face.blink > G.TUNE.blink && remoteG.face.blink > G.TUNE.blink, () => { FX.travel({ x: 20, y: 40 }, () => ({ x: W - 20, y: H * 0.5 }), "🌠", () => FX.burst(W - 60, H * 0.5, ["✨", "⭐"], 12, 200)); FX.banner(W / 2, H * 0.28, "make a wish 🌠"); FX.Sound.chime(); });

  // boop: local points toward the seam -> lands on partner's nose
  edge("boop", localG.point.active && localG.point.x > 0.9 && remoteG.face.nose, () => {
    const p = toCanvas(remoteG.face.nose, 1 - mySide); FX.emoji(p.x, p.y, 0, 0, "👉", 50, 0.8, 0); FX.ring(p.x, p.y, "#ffd2e0"); FX.Sound.pop();
  });

  // mood mirror (section 8): warm when both happy, cool when sad
  const happy = (localG.face.smile + remoteG.face.smile) / 2;
  const sad = (localG.face.frown + remoteG.face.frown) / 2;
  if (happy > 0.35) FX.setTint(255, 140, 175, Math.min(0.22, happy * 0.3));
  else if (sad > 0.4) FX.setTint(110, 150, 255, Math.min(0.2, sad * 0.3));
  else FX.setTint(255, 140, 175, 0);
}
function nearSeam(g, side) {       // return the hand nearest the centre seam, if close
  let best = null;
  for (const h of g.hands) if (h.x > G.TUNE.seam && (!best || h.x > best.x)) best = h;
  return best;
}

// fog received from partner's kiss; toss arriving from partner (section 4)
let fogTime = 0;
function handleFreeNet(m) {
  if (m.t === "fog") { FX.setFog(0, true); fogTime = 3; }
  else if (m.t === "toss") throws.push({ x: mySide === 0 ? MID - 20 : MID + 20, y: (m.yN || 0.5) * H, vx: mySide === 0 ? -300 : 300, vy: -120, ch: m.ch || "💖", s: 46 });
  else if (m.t === "love-msg") { FX.banner(W / 2, H * 0.3, m.text || "💌"); FX.flood(0, W, ["💕", "💗"], 20); FX.Sound.chime(); }
  else if (m.t === "confetti") { FX.confetti(MID * 0.5, H * 0.4, 18); FX.confetti(MID * 1.5, H * 0.4, 18); }
  else if (m.t === "buzz") { try { navigator.vibrate && navigator.vibrate([90, 50, 90]); } catch (_) {} FX.banner(W / 2, H * 0.3, "💓 love tap!"); FX.flood(0, W, ["💓", "💗"], 14); FX.Sound.pop(); }
}
function fireConfetti() { FX.confetti(MID * 0.5, H * 0.4, 18); FX.confetti(MID * 1.5, H * 0.4, 18); FX.Sound.chime(); net.send({ t: "confetti" }); }

// 💑 days-together counter
function refreshAnniv() {
  const el = $("anniv"); if (!el) return;
  const l = el.querySelector(".lbl") || el;
  let d = null; try { d = localStorage.getItem("wm_anniv"); } catch (_) {}
  if (!d) { l.textContent = "set date"; return; }
  const days = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));
  l.textContent = `${days} days`;
}
async function setAnniv() {
  const cur = (() => { try { return localStorage.getItem("wm_anniv") || ""; } catch (_) { return ""; } })();
  const v = await host.ask("Your anniversary / first date (YYYY-MM-DD):", { value: cur });
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) { try { localStorage.setItem("wm_anniv", v.trim()); } catch (_) {} refreshAnniv(); }
}

// 💌 sweet-nothings generator
const SWEET = ["i love you 💛", "miss you 🥺", "you're cute 😘", "thinking of you 💭",
  "my favorite person ✨", "wish you were here 🫶", "you + me 💕", "best girl 🌸",
  "ily to the moon 🌙", "marry me? 💍", "you make me smile 😊", "cutie patootie 🥰"];
function sendSweet() {
  const t = SWEET[Math.floor(Math.random() * SWEET.length)];
  FX.banner(W / 2, H * 0.3, t); FX.flood(0, W, ["💕", "💗"], 20); FX.Sound.chime();
  net.send({ t: "love-msg", text: t });
}

// ---- couple meters / counters ---------------------------------------------
let loveMeter = 0, loveMaxed = false, kissesToday = 0;
function bumpDaily(key) {
  const today = new Date().toISOString().slice(0, 10);
  let s = {}; try { s = JSON.parse(localStorage.getItem(key) || "{}"); } catch (_) {}
  const n = (s.date === today ? s.n || 0 : 0) + 1;
  try { localStorage.setItem(key, JSON.stringify({ date: today, n })); } catch (_) {}
  return n;
}

// ---- couple streak (session combo + daily, localStorage) ------------------
let dayStreak = 0;
function loadStreak() { try { const s = JSON.parse(localStorage.getItem("wm_streak") || "{}"); dayStreak = s.streak || 0; return s; } catch (_) { return {}; } }
function bumpStreak(heart) {
  combo++;
  const s = loadStreak();
  const today = new Date().toISOString().slice(0, 10);
  if (s.last !== today) {
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    dayStreak = s.last === y ? (s.streak || 0) + 1 : 1;
    try { localStorage.setItem("wm_streak", JSON.stringify({ last: today, streak: dayStreak })); } catch (_) {}
  }
  const el = $("streak");
  if (el) { const l = el.querySelector(".lbl") || el; l.textContent = `x${combo}` + (dayStreak > 1 ? ` · ${dayStreak}d` : ""); el.classList.remove("hidden"); }
}

// ---- reaction weather + beat-reactive (section 8) -------------------------
function updateAmbient() {
  const happy = inCall ? (localG.face.smile + remoteG.face.smile) / 2 : localG.face.smile;
  const sad = inCall ? (localG.face.frown + remoteG.face.frown) / 2 : localG.face.frown;
  if (happy > 0.4) FX.setWeather("sun", Math.min(1, happy));
  else if (sad > 0.4) FX.setWeather("rain", Math.min(1, sad));
  else FX.setWeather("stars", 0.4);
  // seasonal sprinkle (subtle, by date)
  const d = new Date(), md = (d.getMonth() + 1) * 100 + d.getDate();
  let s = null;
  if (d.getMonth() === 11) s = "❄️"; else if (md === 214) s = "💝"; else if (md === 101 || md === 704) s = "🎆"; else if (md === 1031) s = "🎃";
  if (s && Math.random() < 0.025) FX.emoji(FX.rnd(0, W), -20, FX.rnd(-10, 10), FX.rnd(40, 90), s, FX.rnd(20, 34), FX.rnd(3, 5), 30, { vr: 0 });
}
// =====================================================================
//  RENDER
// =====================================================================
const squish = [0, 0];            // cheek-squish amount per side (eased)
function drawFeed(video, side, has) {
  ctx.save();
  ctx.beginPath(); ctx.rect(side * MID, 0, MID, H); ctx.clip();
  if (squish[side] > 0.01) { const cx = side * MID + MID / 2; ctx.translate(cx, 0); ctx.scale(1 - 0.28 * squish[side], 1 + 0.12 * squish[side]); ctx.translate(-cx, 0); }
  if (has && video.readyState >= 2) {
    ctx.translate(side * MID + MID, 0); ctx.scale(-1, 1);          // selfie-mirror BOTH halves
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    const sc = Math.max(MID / vw, H / vh), dw = vw * sc, dh = vh * sc;
    const filt = ENHANCE[enhanceLevel]; if (filt && filt !== "none") ctx.filter = filt;   // pop the webcam
    ctx.drawImage(video, (MID - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.filter = "none";
  } else {
    const cx = side * MID + MID / 2;
    const g = ctx.createLinearGradient(side * MID, 0, side * MID, H);
    g.addColorStop(0, "#0e1120"); g.addColorStop(1, "#0a0c16");
    ctx.fillStyle = g; ctx.fillRect(side * MID, 0, MID, H);
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.9; ctx.font = "44px serif"; ctx.fillText("💫", cx, H / 2 - 34);
    ctx.globalAlpha = 1; ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "500 19px system-ui";
    ctx.fillText("waiting for your partner…", cx, H / 2 + 24);
    ctx.restore();
  }
  ctx.restore();
}

function drawCursors() {
  for (const [g, side] of [[localG, mySide], [inCall ? remoteG : null, 1 - mySide]]) {
    if (!g) continue;
    for (const h of (g.hands || [])) {
      const p = toCanvas(h, side);
      ctx.save(); ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.restore();
    }
  }
}

const FRAME_MS = 1000 / 30;        // cap render to 30fps — quality over framerate
function loop() {
  requestAnimationFrame(loop);
  if (!playing) return;
  const t = performance.now();
  if (t - (loop._draw || 0) < FRAME_MS - 1.5) return;       // throttle (skip extra refresh ticks)
  const dt = Math.min(0.05, (t - (loop._last || t)) / 1000); loop._last = t; loop._draw = t; frame++;

  detectLocal(dt);
  stepObjects(); stepPose(); stepSeg();
  // 👁 global: close your eyes for a moment, then the photo snaps just AFTER you
  // reopen them (so your eyes are open in the shot). Silent — saved to Scrapbook.
  if (eyeCapOn && localG.face.present) {
    const closed = localG.face.blink > 0.55;
    if (closed) { eyeClosedT += dt; if (eyeClosedT > 0.4) eyeArmed = true; eyeReopen = -1; }
    else {
      eyeClosedT = 0;
      if (eyeArmed) {
        eyeReopen = eyeReopen < 0 ? 0 : eyeReopen + dt;
        if (eyeReopen > 0.25) { eyeArmed = false; eyeReopen = -1; snapCount++; host.snapMoment(); FX.flash(); FX.banner(W / 2, H * 0.28, `📸 saved! (${snapCount})`); FX.Sound.pop(); if (host.memory) host.memory.note("photo", "saved a candid photo 📸"); }
      }
    }
  } else { eyeClosedT = 0; eyeArmed = false; eyeReopen = -1; }
  squish[0] += (squishTarget[0] - squish[0]) * 0.25; squish[1] += (squishTarget[1] - squish[1]) * 0.25;
  if (fogTime > 0) { fogTime -= dt; if (localG.pinch.active) { const p = toCanvas(localG.pinch, 0); FX.wipeFog(0, p.x / MID, p.y / H); } else if (localG.palm) FX.wipeFog(0, localG.palm.x, localG.palm.y); if (fogTime <= 0) FX.setFog(0, false); }

  const sh = FX.getShake();
  ctx.setTransform(RS, 0, 0, RS, sh.x * RS, sh.y * RS);
  ctx.clearRect(-60, -60, W + 120, H + 120);

  drawFeed(localVideo, mySide, true);
  drawFeed(remoteVideo, 1 - mySide, inCall && haveRemoteVideo);
  ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(MID - 1, 0, 2, H);

  audio.stepBeat(); updateAmbient();
  if (games.mode === "free") {
    sideEffects(localG, mySide, dt);
    if (inCall && remoteG.present) sideEffects(remoteG, 1 - mySide, dt);
    if (!soloFx) { coupleEffects(dt); tossUpdate(dt); }     // single-feature games stay pure
  } else {
    squishTarget[0] = squishTarget[1] = 0;
    games.update(dt, localG, inCall ? remoteG : nullDummy());
  }

  FX.stepScreen(dt); FX.stepParticles(dt); FX.stepOverlays(dt);
  FX.drawScreen(ctx);
  hudReset();                                          // modes populate the DOM HUD via big()/hint()/scoreboard()
  if (games.mode === "free") drawFreeOverlay(ctx); else games.draw(ctx);
  FX.drawParticles(ctx); FX.drawOverlays(ctx);
  drawCursors();
  updateModeHud(hudState());                            // flush caption + score bar to the DOM
  if (!stackCanvas.classList.contains("hidden")) {      // 📱 re-composite halves vertically
    const mw = Math.round(MID * RS), mh = Math.round(H * RS);
    sctx.drawImage(canvas, 0, 0, mw, mh, 0, 0, mw, mh);
    sctx.drawImage(canvas, mw, 0, mw, mh, 0, mh, mw, mh);
  }
}
const _dummy = G.blankState();
function nullDummy() { return _dummy; }

// Snapshot of "the room" for the AI Director — energy, mood, lull, session arc.
function roomState() {
  const l = localG, r = inCall ? remoteG : null;
  const bothPresent = !!(l.present && r && r.present);
  const smile = bothPresent ? (l.face.smile + r.face.smile) / 2 : l.face.smile;
  const laugh = !!(l.face.laugh || (r && r.face.laugh));
  const kiss = !!(l.face.kiss > G.TUNE.kiss && r && r.face.kiss > G.TUNE.kiss);
  const heart = !!(l.two.heart && r && r.two.heart);
  const hug = !!(l.two.armsWide && r && r.two.armsWide);
  const audioLvl = (host.audio && host.audio.level) || 0;
  const energy = Math.min(1, audioLvl * 1.7 + (laugh ? 0.5 : 0) + Math.max(0, smile - 0.3));
  const zoned = !!(l.face.zoned || (r && r.face.zoned));
  return {
    bothPresent, smile, laugh, kiss, heart, hug, energy, zoned,
    idleMs: performance.now() - lastInteractT, elapsedMs: performance.now() - sessionStartT,
    mode: games.mode, cat: (MODE_INFO[games.mode] || {}).cat || "", hour: new Date().getHours(), inCall,
  };
}

// ---- DOM HUD: caption card (below video) + score bar (above) --------------
// Modes call big()/hint()/scoreboard() (in modes/ui.js) which now write state
// instead of painting the video; we mirror that state into real DOM here, diffed
// so we only touch the DOM when the text actually changes.
const modeHud = { title: "", sub: "", hint: "", score: "" };
function clearModeHud() {
  modeHud.title = modeHud.sub = modeHud.hint = modeHud.score = "";
  ["capTitle", "capSub", "capHint"].forEach((id) => { const el = $(id); el.textContent = ""; el.classList.add("hidden"); });
  $("modeCaption").classList.add("hidden"); $("scoreBar").classList.add("hidden");
}
function updateModeHud(s) {
  const title = s ? s.title : "", sub = s ? s.sub : "", hint = s ? s.hint : "";
  if (title !== modeHud.title) { const el = $("capTitle"); el.textContent = title; el.classList.toggle("hidden", !title); modeHud.title = title; }
  if (sub !== modeHud.sub) { const el = $("capSub"); el.textContent = sub; el.classList.toggle("hidden", !sub); modeHud.sub = sub; }
  if (hint !== modeHud.hint) { const el = $("capHint"); el.textContent = hint; el.classList.toggle("hidden", !hint); modeHud.hint = hint; }
  $("modeCaption").classList.toggle("hidden", !(title || sub || hint));
  const sc = s && s.score;
  const timeStr = sc && sc.time != null ? Math.max(0, Math.ceil(sc.time)) + "s" : "";
  const key = sc ? `${sc.title}|${sc.a}|${sc.b}|${timeStr}` : "";
  if (key !== modeHud.score) {
    modeHud.score = key;
    $("scoreBar").classList.toggle("hidden", !sc);
    if (sc) {
      $("sbTitle").textContent = sc.title || "";
      $("sbScore0").textContent = sc.a; $("sbScore1").textContent = sc.b;
      const tm = $("sbTime"); tm.textContent = timeStr; tm.classList.toggle("hidden", !timeStr);
      const mine = amInitiator ? 0 : 1;                 // authority (player 0) is on the left
      $("sbName0").textContent = mine === 0 ? "you" : "partner";
      $("sbName1").textContent = mine === 0 ? "partner" : "you";
    }
  }
}

// =====================================================================
//  INIT + NETWORK (Trystero, reused pattern)
// =====================================================================
async function initModels() {
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM);
  handLM = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" }, runningMode: "VIDEO", numHands: 2 });
  faceLM = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
}
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24, max: 30 }, facingMode: "user" },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  localVideo.srcObject = stream; await localVideo.play(); return stream;
}

function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
const roomId = (w) => "wm" + hashStr(w.trim().toLowerCase());
let entries = [], primary = null, localStream = null;

// Compact packet — round coords to 2 decimals & drop inactive x/y so the data
// channel doesn't flood and starve the voice/audio stream.
const r2 = (v) => Math.round(v * 100) / 100;
const rp = (p) => p ? { x: r2(p.x), y: r2(p.y) } : null;
function packet() {
  const g = localG, F = g.face, tw = g.two;
  return {
    k: "g", pid: myPid, present: g.present, wave: g.wave, fingers: g.fingers, handSpeed: r2(g.handSpeed), poses: g.poses,
    pinch: g.pinch.active ? { active: true, x: r2(g.pinch.x), y: r2(g.pinch.y) } : { active: false },
    point: g.point.active ? { active: true, x: r2(g.point.x), y: r2(g.point.y) } : { active: false },
    palm: rp(g.palm), hands: (g.hands || []).map(rp),
    two: {
      heart: tw.heart, frame: tw.frame, clap: tw.clap, cup: tw.cup, armsWide: tw.armsWide, prayer: tw.prayer, handsUp: tw.handsUp,
      spread: { active: tw.spread.active, dist: r2(tw.spread.dist) },
      twist: { active: tw.twist.active, angle: r2(tw.twist.angle) },
      circle: tw.circle.active ? { active: true, x: r2(tw.circle.x), y: r2(tw.circle.y), r: r2(tw.circle.r) } : { active: false, x: 0, y: 0, r: 0 },
    },
    face: { present: F.present, smile: r2(F.smile), kiss: r2(F.kiss), brow: r2(F.brow), frown: r2(F.frown), blink: r2(F.blink), tongue: r2(F.tongue), laugh: F.laugh, wink: F.wink, mouthOpen: r2(F.mouthOpen), tilt: r2(F.tilt), zoned: F.zoned, headShake: F.headShake, nod: F.nod, nose: rp(F.nose), mouth: rp(F.mouth) },
  };
}

// ---- connection: race mqtt + torrent, retry fast until connected ----------
let connectedOnce = false, reconnectTimer = null, reconnectAttempts = 0, roomWord = "", lastRx = 0, lastConnectAt = 0;

// Stable per-device id (survives reload/reconnect) → who's left/right & who judges
// never changes mid-session, unlike Trystero's per-join selfId.
let myPid = "";
try { myPid = localStorage.getItem("wm_pid") || ""; } catch (_) {}
if (!myPid) { try { myPid = (window.crypto && crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2); } catch (_) { myPid = String(Math.random()).slice(2); } try { localStorage.setItem("wm_pid", myPid); } catch (_) {} }
let theirPid = "";
function setRole(pid) {
  if (!pid || pid === theirPid) return;
  theirPid = pid;
  amInitiator = myPid > theirPid;               // deterministic & identical on both ends
  games.setAuthority(amInitiator); mySide = amInitiator ? 0 : 1;
}
function leaveRooms() { entries.forEach((e) => { try { e.room.leave(); } catch (_) {} }); entries = []; primary = null; sendMsg = null; }
function route(data) {
  lastRx = Date.now();
  if (data && data.k === "g") { setRole(data.pid); remoteG = Object.assign(G.blankState(), data); remoteG.present = true; return; }
  if (!data) return;
  if (data.t === "nav") { navTo(data.screen, data.mode, true); return; }
  if (data.t === "cap" || data.t === "llm-req" || data.t === "llm-res") { host.ai.onNet(data); return; }
  if (data.t === "mem") { memory.applyRemote(data.snap); return; }
  if (data.t === "chat") { host.chat.say(data.who, data.text); return; }
  if (data.t === "ai-act") { const fn = aiToolsLocal[data.a]; if (fn) try { fn(data.arg); } catch (_) {} return; }   // Cupid's move, mirrored to this screen
  if (data.t === "whisper") { host.chat.whisper(data.text); return; }                                               // a secret meant only for me
  if (data.t === "aig" && data.spec) setAiGameSpec(data.spec);   // stash Cupid's game spec (falls through so an active aigame mode also applies it)
  if (typeof data.t === "string" && data.t.startsWith("share-") && games.mode !== "share") navTo("play", "share", true);
  games.onNet(data); handleFreeNet(data);
}
function connect(word, stream) {
  if (word != null) roomWord = word; if (stream) localStream = stream;
  if (typeof Trystero === "undefined") { setConn("net failed"); return; }
  lastConnectAt = Date.now();
  leaveRooms();
  const cfg = { appId: "webcam-magic", relayConfig: { redundancy: 6 } };
  const rid = roomId(roomWord);
  setConn(reconnectAttempts ? "reconnecting…" : "connecting…");
  [["mqtt", Trystero.mqtt], ["torrent", Trystero.torrent]].forEach(([nm, strat]) => {
    if (!strat || typeof strat.joinRoom !== "function") return;
    let r; try { r = strat.joinRoom(cfg, rid); } catch (_) { return; }
    const action = r.makeAction("m");            // this build returns an object, not [send, get]
    action.onMessage = route;
    const entry = { room: r, action, connected: false };
    r.onPeerJoin = (pid) => {
      entry.connected = true; connectedOnce = true; reconnectAttempts = 0; clearTimeout(reconnectTimer); lastRx = Date.now();
      // role (side / who judges) comes from the stable pid exchanged in packets, not selfId
      if (!primary) { primary = entry; sendMsg = (o) => { const e = entries.find((x) => x.connected); if (e) e.action.send(o); }; }   // one transport only (no double-send)
      if (localStream) localStream.getTracks().forEach((tr) => { try { r.addTrack(tr, localStream, { target: pid }); } catch (_) {} });
      setConn("connected 💚"); ai.announce();
      try { net.send({ t: "mem", snap: memory.snapshot() }); } catch (_) {}
    };
    r.onPeerLeave = () => { entry.connected = false; if (!entries.some((e) => e.connected)) { connectedOnce = false; remoteG = G.blankState(); haveRemoteVideo = false; setConn("waiting…"); scheduleReconnect(); } };
    r.onPeerStream = (st) => { remoteVideo.srcObject = st; remoteVideo.play().catch(() => {}); haveRemoteVideo = true; };
    r.onPeerTrack = (tr, st) => { remoteVideo.srcObject = st; remoteVideo.play().catch(() => {}); haveRemoteVideo = true; };
    entries.push(entry);
  });
  scheduleReconnect();
}
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = Math.min(8000, 3000 + reconnectAttempts * 1200);   // retry fast (3s), back off to 8s
  reconnectTimer = setTimeout(() => { if (!connectedOnce && roomWord) { reconnectAttempts++; connect(); } }, delay);
}
// heartbeat: gesture packets stream constantly; if they go silent, rejoin
setInterval(() => { if (sendMsg) sendMsg(packet()); }, 100);
setInterval(() => {
  // only a genuinely silent link (12s) triggers a rejoin, and not more than once
  // every 8s — avoids both ends flapping and tearing down working media.
  if (connectedOnce && Date.now() - lastRx > 12000 && Date.now() - lastConnectAt > 8000) {
    connectedOnce = false; setConn("reconnecting…"); reconnectAttempts++; connect();
  }
}, 3000);
window.addEventListener("beforeunload", leaveRooms);

// =====================================================================
//  SCREENS  (lobby → menu → ready → play)
// =====================================================================
function setConn(t) {
  const state = /connected/i.test(t) ? "ok" : /solo/i.test(t) ? "off" : "warn";
  const label = t.replace(/\s*💚\s*$/, "");                 // dot now conveys status
  [$("connPill"), $("connPill2")].forEach((el) => { el.textContent = label; el.dataset.state = state; });
}
const SCREENS = ["lobby", "menu", "ready", "play"];
function show(id) { SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== id)); playing = (id === "play"); }

let pendingMode = "free";
function navTo(screen, mode, fromNet) {
  if (!fromNet) bumpInteract();
  if (mode) pendingMode = mode;
  if (screen === "play") enterPlay(pendingMode);
  else if (screen === "ready") { showReady(pendingMode); show("ready"); }
  else { buildDeck(); show("menu"); }
  if (!fromNet && inCall) net.send({ t: "nav", screen, mode: pendingMode });
}
function enterPlay(mode) {
  if (mode.startsWith("fx:")) { soloFx = mode.slice(3); games.setMode("free"); }   // single Free feature
  else { soloFx = null; games.setMode(mode); }
  FX.clearParticles();
  const mi = MODE_INFO[mode];
  const mp = $("modePill"); mp.querySelector(".mp-icon").innerHTML = modeIcon(mode, mi && mi.cat); mp.querySelector(".mp-name").textContent = mi ? mi.nm : mode;
  const bar = $("actionbar"); bar.innerHTML = "";
  (MODE_ACTIONS[mode] || []).forEach(([a, label]) => {
    const b = document.createElement("button");
    const clean = String(label).replace(/^[^\p{L}\p{N}]+/u, "").trim();      // drop the leading emoji
    const ic = ACT_ICON[a];
    b.innerHTML = (ic ? `<span class="icon">${ic}</span>` : "") + (clean ? `<span>${clean}</span>` : (ic ? "" : `<span>${a}</span>`));
    b.onclick = () => games.action(a);
    bar.appendChild(b);
  });
  bar.classList.toggle("hidden", !MODE_ACTIONS[mode]);
  clearModeHud();                                         // fresh caption/score bar for the new mode
  if (host.choices) host.choices(null);
  if (host.chat) host.chat.clear();
  if (host.chat && mi) host.chat.say("sys", mi.nm);
  if (host.director) host.director.intro(mode);           // the host greets + offers one-tap chips
  show("play");
  wakeChrome();
  applyStack();                                           // 📱 stacked view if this mode supports it
  if (!howShown.has(mode)) { howShown.add(mode); showHowTo(mode); } else hideHowTo();
}
function showReady(mode) {
  const m = MODE_INFO[mode] || { ic: "✨", nm: mode, how: [], cat: "" };
  $("readyIcon").innerHTML = modeIcon(mode, m.cat); $("readyName").textContent = m.nm;
  $("readyHow").innerHTML = m.how.map((h) => `<li>${h}</li>`).join("");
}

// Mode catalog (MODE_INFO / MODE_ACTIONS / CAT_ORDER) is assembled in
// modes/registry.js from each topic file's co-located metadata.
function buildMenu() {
  const grid = $("menuGrid"); if (grid.dataset.built) return; grid.dataset.built = "1";
  for (const cat of CAT_ORDER) {
    const ci = CAT_ORDER.indexOf(cat);   // per-category hue accent (see [data-cat] in style.css)
    const title = document.createElement("div"); title.className = "cat-title"; title.textContent = cat; title.dataset.cat = ci; grid.appendChild(title);
    let showAll = false; try { showAll = localStorage.getItem("wm_showall") === "1"; } catch (_) {}
    for (const id in MODE_INFO) if (MODE_INFO[id].cat === cat) {
      if (id === "typing" && !showAll && matchMedia("(pointer: coarse)").matches) continue;   // keyboard game, hidden on touch
      const m = MODE_INFO[id], card = document.createElement("div"); card.className = "card-mode"; card.dataset.cat = ci;
      card.dataset.nm = (m.nm + " " + cat).toLowerCase();
      card.innerHTML = `<div class="ic">${modeIcon(id, cat)}</div><div class="nm">${m.nm}</div>`;
      card.onclick = () => navTo("play", id);
      grid.appendChild(card);
    }
  }
}

// live search over the menu cards; also hides category titles that end up empty
function filterMenu(q) {
  q = (q || "").trim().toLowerCase(); const grid = $("menuGrid");
  const deck = $("deck"); if (deck) deck.classList.toggle("hidden", !!q);
  let shown = 0;
  grid.querySelectorAll(".card-mode").forEach((c) => { const hide = !!q && !(c.dataset.nm || "").includes(q); c.classList.toggle("filtered", hide); if (!hide) shown++; });
  grid.querySelectorAll(".cat-title").forEach((t) => {
    let n = t.nextElementSibling, any = false;
    while (n && !n.classList.contains("cat-title")) { if (n.classList.contains("card-mode") && !n.classList.contains("filtered")) any = true; n = n.nextElementSibling; }
    t.classList.toggle("filtered", !any);
  });
  const empty = $("menuEmpty");
  if (q && shown === 0) { empty.textContent = `No modes match “${q}”. Try another word or press Surprise us.`; empty.classList.remove("hidden"); }
  else empty.classList.add("hidden");
}
function surprise() { const ids = Object.keys(MODE_INFO).filter((id) => id !== "free"); navTo("play", ids[Math.floor(Math.random() * ids.length)]); }

// ---- tappable answers: modes call host.choices(["A","B"], cb) — floating pill
// buttons between the video and the caption. Tap beats gesture on phones; the
// gesture inputs still work as an alternative. host.choices(null) clears.
const choiceBar = document.createElement("div");
choiceBar.id = "choiceBar"; choiceBar.className = "hidden";
$("stageCol").insertBefore(choiceBar, $("modeCaption"));
host.choices = (list, cb) => {
  choiceBar.innerHTML = "";
  if (!list || !list.length) { choiceBar.classList.add("hidden"); return; }
  list.forEach((label, i) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    b.onclick = () => { bumpInteract(); choiceBar.querySelectorAll("button").forEach((x) => x.classList.toggle("picked", x === b)); try { cb && cb(i); } catch (_) {} };
    choiceBar.appendChild(b);
  });
  choiceBar.classList.remove("hidden");
};

// ---- "✨ Right now" deck: Cupid-curated picks for this moment, atop the catalog
const DECK_POOLS = {
  early: ["thisorthat", "wyr", "rps", "pop", "spinner", "photobooth", "trivia", "catch"],
  mid: ["aigame", "dancebattle", "charades", "pictionary", "howwell", "telepathy", "reaction", "photobooth"],
  late: ["truthdare", "loversdice", "never", "roleplay", "kisscam", "slowdance", "deeptalk", "dareroulette"],
};
function buildDeck() {
  const deck = $("deck"); if (!deck) return; deck.innerHTML = "";
  const h = new Date().getHours();
  const pool = h >= 22 || h < 5 ? DECK_POOLS.late : h >= 18 ? DECK_POOLS.mid : DECK_POOLS.early;
  const sample = (arr) => { const a = arr.filter((id) => MODE_INFO[id] && id !== games.mode); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const picks = [...new Set(["aigame", ...sample(pool)])].slice(0, 6);
  const title = document.createElement("div"); title.className = "deck-title"; title.textContent = "✨ Right now"; deck.appendChild(title);
  const row = document.createElement("div"); row.className = "deck-row"; deck.appendChild(row);
  for (const id of picks) {
    const m = MODE_INFO[id]; if (!m) continue;
    const c = document.createElement("div"); c.className = "deck-card"; c.dataset.cat = CAT_ORDER.indexOf(m.cat);
    c.innerHTML = `<div class="ic">${modeIcon(id, m.cat)}</div><div class="d-name"></div><div class="d-sub"></div>`;
    c.querySelector(".d-name").textContent = m.nm;
    c.querySelector(".d-sub").textContent = (m.how && m.how[0]) || "";
    c.onclick = () => navTo("play", id);
    row.appendChild(c);
  }
}

// ---- how-to toast: guidelines float over the video instead of a blocking screen
const howShown = new Set();
let htTimer = 0;
function showHowTo(mode) {
  const m = MODE_INFO[mode]; if (!m || !m.how || !m.how.length) return;
  $("htIcon").textContent = m.ic || "✨"; $("htName").textContent = m.nm;
  $("htHow").innerHTML = m.how.map((h) => `<li>${h}</li>`).join("");
  $("howToast").classList.remove("hidden");
  clearTimeout(htTimer); htTimer = setTimeout(hideHowTo, 12000);
}
function hideHowTo() { $("howToast").classList.add("hidden"); clearTimeout(htTimer); }
$("htClose").addEventListener("click", hideHowTo);
$("howBtn").addEventListener("click", () => showHowTo(games.mode));

// ---- Cupid dock: tuckable; while tucked, his lines float over the video ------
let dockMin = false, unread = 0;
function reflectBadge() { const b = $("dockBadge"); b.textContent = unread > 9 ? "9+" : unread; b.classList.toggle("hidden", !unread); }
function setDockMin(min) {
  dockMin = min; unread = 0; reflectBadge();
  $("play").classList.toggle("dock-min", min);
  $("dockFab").classList.toggle("hidden", !min);
}
$("dockMin").addEventListener("click", () => setDockMin(true));
$("dockFab").addEventListener("click", () => setDockMin(false));
function pushToast(text) {
  const wrap = $("toasts"); const el = document.createElement("div"); el.className = "toast";
  el.innerHTML = `<span class="t-avatar">${ICON.sparkles}</span><span></span>`;
  el.lastElementChild.textContent = text;
  wrap.appendChild(el);
  while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, 6500);
}
{ // while tucked away, Cupid/partner messages surface over the video + badge up;
  // a mode ASKING for typed input pops the dock back open so the field is reachable
  const origSay = chat.say, origWhisper = chat.whisper, origAsk = chat.ask;
  chat.say = (from, text) => { origSay(from, text); if (dockMin && playing && text && (from === "ai" || from === "partner")) { pushToast(text); unread++; reflectBadge(); } };
  chat.whisper = (text) => { origWhisper(text); if (dockMin && playing && text) { pushToast("🤫 " + text); unread++; reflectBadge(); } };
  chat.ask = (label, opts) => { if (dockMin) setDockMin(false); return origAsk(label, opts); };
}
// landscape phones: start with Cupid tucked — the floating dock would cover half
// the video. (Portrait keeps the dock: it fills the space under the 16:9 canvas.)
if (matchMedia("(orientation: landscape) and (max-height: 520px)").matches) setDockMin(true);

// ---- 📱 stacked-view switching. Audited 2026-07: these modes draw SHARED
// full-width canvas content (boards / meters / lyric crawls / centered text)
// that would tear at the seam — they keep the classic side-by-side view.
const NO_STACK = new Set([
  "hockey", "thumbwar", "photobooth", "tictactoe", "connect4", "memory",
  "pictionary", "mailbox", "bucket", "karaoke", "dareroulette", "loversdice",
  "oursong", "share",
]);
const stackMQ = matchMedia("(orientation: portrait) and (max-width: 820px)");
let stackPref = true; try { stackPref = localStorage.getItem("wm_stack") !== "0"; } catch (_) {}
function applyStack() {
  const on = stackPref && stackMQ.matches && playing && !NO_STACK.has(games.mode);
  canvas.classList.toggle("hidden", on);
  stackCanvas.classList.toggle("hidden", !on);
  $("play").classList.toggle("stacked", on);
  FX.setStacked(on);
  if (on && !$("play").classList.contains("dock-min")) setDockMin(true);   // video IS the screen now
}
try { stackMQ.addEventListener("change", applyStack); } catch (_) { stackMQ.addListener && stackMQ.addListener(applyStack); }
window.addEventListener("resize", () => { clearTimeout(applyStack._t); applyStack._t = setTimeout(applyStack, 150); });   // rotation fallback

// ---- idle chrome: the top bar melts away so the two of you fill the screen ---
let chromeT = 0;
function wakeChrome() { $("play").classList.remove("chrome-idle"); clearTimeout(chromeT); chromeT = setTimeout(() => $("play").classList.add("chrome-idle"), 4500); }
["pointermove", "pointerdown", "keydown", "touchstart"].forEach((ev) => $("play").addEventListener(ev, wakeChrome, { passive: true }));

$("backToCall").addEventListener("click", () => navTo("play", games.mode || "free"));
$("moreBtn").addEventListener("click", (e) => { e.stopPropagation(); $("morePop").classList.toggle("hidden"); });
document.addEventListener("click", (e) => { if (!e.target.closest(".tb-more")) $("morePop").classList.add("hidden"); });

// ✨ AI status pill (menu + play). Shows tier/load state; click loads the model.
function aiPillText(short) {
  const ai = host.ai; if (!ai || !ai.tier) return short ? "AI" : "AI off";
  if (ai.status === "ready") return short ? "on" : `AI on (${ai.tier === 3 ? "server" : ai.tier === 2 ? "power" : "light"})`;
  if (ai.status === "loading") return Math.round((ai.progress || 0) * 100) + "%";
  return ai.available() ? (short ? "load" : "load AI") : "AI";
}
function refreshAiPills() {
  const ready = host.ai && host.ai.status === "ready";
  [["aiPill", false], ["aiPill2", true]].forEach(([id, short]) => {
    const el = $(id); if (!el) return;
    const lbl = el.querySelector(".lbl"); if (lbl) lbl.textContent = aiPillText(short); else el.textContent = aiPillText(short);
    el.classList.toggle("on", ready);
  });
}
// tappable AI settings (phone-friendly — no console needed): paste a home-server
// URL, or load the on-device model. Server URL persists + auto-shares to partner.
function aiPillClick() {
  const ai = host.ai; if (!ai) return;
  const label = ai.tier === 3 ? "home server ✅" : ai.tier === 2 ? "on-device (powerhouse)" : ai.tier === 1 ? "on-device (light)" : "off / static decks";
  const wrap = document.createElement("div"); wrap.className = "ask-modal";
  wrap.innerHTML = `<div class="ask-card">
    <label>🤖 AI — currently: <b>${label}</b></label>
    <label class="dlabel">Home-server URL (from <code>server/start.sh</code>)</label>
    <input type="text" id="aiSrvUrl" placeholder="https://xxxx.trycloudflare.com" autocomplete="off" autocapitalize="off" />
    <input type="text" id="aiSrvModel" placeholder="model — optional, e.g. active / dolphin3:8b" autocomplete="off" autocapitalize="off" />
    <label class="dlabel">Vibe — how far the AI goes</label>
    <select id="aiSpice"><option value="0">Sweet (PG)</option><option value="1">Flirty</option><option value="2">Uncensored</option></select>
    <div class="dlabel" id="aiMsg" style="min-height:1.2em"></div>
    <div class="ask-row">
      <button class="ask-cancel" id="aiClose">Close</button>
      <button id="aiLoadLocal">Load on-device</button>
      <button id="aiUseSrv">Use server</button>
    </div></div>`;
  document.body.appendChild(wrap);
  const url = wrap.querySelector("#aiSrvUrl"), model = wrap.querySelector("#aiSrvModel");
  try { url.value = ai.serverUrl || localStorage.getItem("wm_ai_server") || ""; } catch (_) {}
  const spice = wrap.querySelector("#aiSpice");
  if (spice && host.memory) { spice.value = String(host.memory.spice != null ? host.memory.spice : 2); spice.addEventListener("change", () => host.memory.setSpice(+spice.value)); }
  const close = () => wrap.remove();
  wrap.querySelector("#aiClose").onclick = close;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  const msg = wrap.querySelector("#aiMsg");
  wrap.querySelector("#aiLoadLocal").onclick = () => { ai.load(); close(); };
  wrap.querySelector("#aiUseSrv").onclick = async () => {
    const u = url.value.trim(); if (!u) return close();
    msg.textContent = "checking " + u + " …";
    await ai.configure(u, model.value.trim() || undefined);
    if (inCall) ai.announce(); refreshAiPills();
    if (ai.tier === 3) { msg.textContent = "✅ connected — AI on (server)"; setTimeout(close, 800); }
    else { msg.textContent = "✗ couldn't reach it — is the tunnel + Ollama running? (see the browser console)"; }
  };
}

// =====================================================================
//  BOOT + UI WIRING
// =====================================================================
async function boot(callMode) {
  $("lobbyHint").textContent = "Loading magic… (hand + face models, ~few MB, once)";
  try {
    await initModels();
    const stream = await startCamera();
    audio.initBeat(stream); loadStreak(); buildDebug(); refreshAnniv(); buildMenu();
    ai.init();
    inCall = !!callMode;
    if (callMode) connect($("roomInput").value.trim(), stream); else setConn("solo");
    navTo("play", "free", true);          // the date starts ON the call — the catalog is a layer you summon
    requestAnimationFrame(loop);
  } catch (e) { $("lobbyHint").textContent = "Couldn't start: " + (e.message || e) + " — allow camera & use https/localhost."; }
}

const copyLink = async (btn) => { const lbl = btn.querySelector(".lbl") || btn; try { await navigator.clipboard.writeText(location.href); const o = lbl.textContent; lbl.textContent = "copied ✓"; setTimeout(() => (lbl.textContent = o), 1500); } catch (_) {} };
$("joinBtn").addEventListener("click", () => {
  if (!$("roomInput").value.trim()) { $("roomInput").focus(); return; }
  const u = new URL(location.href); u.searchParams.set("room", $("roomInput").value.trim()); history.replaceState(null, "", u);
  boot(true);
});
$("soloBtn").addEventListener("click", () => boot(false));
$("copyLinkBtn").addEventListener("click", (e) => copyLink(e.currentTarget));
$("copyLink2").addEventListener("click", (e) => copyLink(e.currentTarget));
$("tuneBtn").addEventListener("click", () => $("debug").classList.toggle("hidden"));
$("aiPill").addEventListener("click", aiPillClick);
$("aiPill2").addEventListener("click", aiPillClick);
// AI host (Director) — proactive + auto-switch
function reflectDirector() { const b = $("directorBtn"); if (!b) return; const on = host.director && host.director.isOn(); b.classList.toggle("on", on); b.dataset.tip = on ? "AI host on — I'm running the show ✨" : "Let the AI host — proactive + auto-switch"; }
$("directorBtn").addEventListener("click", async () => { if (host.director) { await host.director.setHost(!host.director.isOn()); reflectDirector(); } });
reflectDirector();
setInterval(() => { if (playing && host.director) host.director.tick(); }, 4000);
$("surpriseBtn").addEventListener("click", surprise);
$("menuSearch").addEventListener("input", (e) => filterMenu(e.target.value));
setInterval(refreshAiPills, 700);
$("anniv").addEventListener("click", setAnniv);
// ready screen
$("readyStart").addEventListener("click", () => navTo("play", pendingMode));
$("readyBack").addEventListener("click", () => navTo("menu"));
// play screen controls
$("menuBtn").addEventListener("click", () => navTo("menu"));
$("fxBtn").addEventListener("click", (e) => { fxOn = !fxOn; const b = e.currentTarget; b.classList.toggle("off", !fxOn); b.dataset.tip = fxOn ? "Effects on" : "Effects off"; });
$("snapBtn").addEventListener("click", () => host.snapshot("webcam-magic"));
function reflectEye() { const b = $("eyeBtn"); b.classList.toggle("off", !eyeCapOn); const ic = b.querySelector(".icon"); if (ic) ic.innerHTML = eyeCapOn ? ICON.eye : ICON.eyeOff; b.dataset.tip = eyeCapOn ? "Close eyes to snap (on)" : "Eye-capture off"; }
$("eyeBtn").addEventListener("click", () => { eyeCapOn = !eyeCapOn; try { localStorage.setItem("wm_eyecap", eyeCapOn ? "1" : "0"); } catch (_) {} reflectEye(); });
reflectEye();
// 🎨 webcam enhancement — cycle Natural → Vivid → Sharp → Off
function reflectEnhance() { const b = $("enhanceBtn"); b.classList.toggle("off", enhanceLevel === "off"); b.dataset.tip = "Video look: " + ENH_LABEL[enhanceLevel]; }
$("enhanceBtn").addEventListener("click", () => { enhanceLevel = ENH_ORDER[(ENH_ORDER.indexOf(enhanceLevel) + 1) % ENH_ORDER.length]; try { localStorage.setItem("wm_enh", enhanceLevel); } catch (_) {} reflectEnhance(); });
reflectEnhance();
$("leaveBtn").addEventListener("click", () => location.reload());
$("loveBtn2").addEventListener("click", sendSweet);
$("confettiBtn2").addEventListener("click", fireConfetti);
const SIZES = ["s", "m", "l"];
$("sizeBtn").addEventListener("click", () => { const cur = $("stage").dataset.size, n = SIZES[(SIZES.indexOf(cur) + 1) % 3]; $("stage").dataset.size = n; const l = $("sizeBtn").querySelector(".lbl"); if (l) l.textContent = n.toUpperCase(); });

// live tuning panel — sliders bound to gestures.TUNE
const TUNE_META = {
  smile: [0, 1, .02, "Smile"], kiss: [0, 1, .02, "Kiss/pucker"], brow: [0, 1, .02, "Brows up"],
  frown: [0, 1, .02, "Frown"], blink: [0, 1, .02, "Blink"], tongue: [0, 1, .02, "Tongue"],
  laughJaw: [0, 1, .02, "Laugh: jaw"], laughSmile: [0, 1, .02, "Laugh: smile"],
  pinch: [.2, .8, .01, "Pinch tightness"], snap: [.2, .7, .01, "Snap"], wave: [.004, .04, .002, "Wave speed"],
  seam: [.6, .98, .01, "Seam reach"], zonedSec: [2, 20, 1, "Zoned (sec)"],
};
function buildDebug() {
  const box = $("debug"); if (!box || box.dataset.built) return; box.dataset.built = "1";
  box.insertAdjacentHTML("beforeend", "<h2>🎚 Tuning</h2>");
  for (const k in TUNE_META) {
    const [min, max, step, label] = TUNE_META[k];
    const row = document.createElement("label"); row.className = "drow";
    const val = document.createElement("span"); val.className = "dval"; val.textContent = (+G.TUNE[k]).toFixed(3);
    const inp = document.createElement("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step; inp.value = G.TUNE[k];
    inp.addEventListener("input", () => { G.TUNE[k] = +inp.value; val.textContent = (+inp.value).toFixed(3); });
    row.innerHTML = `<span class="dlabel">${label}</span>`; row.appendChild(inp); row.appendChild(val);
    box.appendChild(row);
  }
}

// phone-friendly: a link like ?ai=https://your-tunnel-url configures the home
// server with no console needed (persisted; runs before ai.init() reads it).
const _q = new URL(location.href).searchParams;
if (_q.get("ai")) { try { localStorage.setItem("wm_ai_server", _q.get("ai")); } catch (_) {} }
if (_q.get("aimodel")) { try { localStorage.setItem("wm_ai_server_model", _q.get("aimodel")); } catch (_) {} }

const pre = new URL(location.href).searchParams.get("room");
if (pre) { $("roomInput").value = pre; $("copyLinkBtn").classList.remove("hidden"); }
$("roomInput").addEventListener("input", () => $("copyLinkBtn").classList.toggle("hidden", !$("roomInput").value.trim()));
