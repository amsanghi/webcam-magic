// app.js — orchestrator: camera, MediaPipe, render loop, free-play effects,
// couple cross-feed effects, mode/game switching, and Trystero networking.
import { HandLandmarker, FaceLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import * as FX from "./effects.js";
import * as G from "./gestures.js";
import { createGames } from "./games.js";

const VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const HAND_MODEL  = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL  = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const { W, H, MID, toCanvas } = FX;
const $ = (id) => document.getElementById(id);
const canvas = $("canvas"), ctx = canvas.getContext("2d");
const localVideo = $("localVideo"), remoteVideo = $("remoteVideo");

// Render at higher-than-logical resolution so the feed isn't upscaled/blurry.
// Drawing math stays in the logical 1280x720 space; the context is scaled by RS,
// so the canvas backing store is RS× sharper (e.g. 2560x1440 on a retina screen).
const RS = Math.min(window.innerWidth, window.innerHeight) < 820
  ? 1.5                                                    // lighter on phones so audio/video stay smooth
  : Math.min(3, Math.max(2, window.devicePixelRatio || 1));
canvas.width = Math.round(W * RS); canvas.height = Math.round(H * RS);
ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";

let handLM = null, faceLM = null;
let inCall = false, fxOn = true, amInitiator = true, haveRemoteVideo = false, playing = false;
let mySide = 0;                 // fixed: player 0 (authority) = left on BOTH screens, player 1 = right
let soloFx = null;              // when set, Free play runs only this one feature
let eyeCapOn = true; try { eyeCapOn = localStorage.getItem("wm_eyecap") !== "0"; } catch (_) {}   // default ON, remembered
let eyeClosedT = 0, eyeArmed = false, eyeReopen = -1, snapCount = 0;   // "close eyes to snap"
let frame = 0, lastFps = performance.now(), fpsCount = 0, lastVideoTime = -1;
let combo = 0;

let localG = G.blankState(), remoteG = G.blankState();

// ---- networking handle passed into games ----------------------------------
const net = { send: (o) => { if (sendMsg) sendMsg(o); } };
let sendMsg = null;
const MOMENTS = [];   // in-memory session gallery (full-res blob URLs) — no auto-download
function persistThumb() {   // small thumbnail for cross-session Scrapbook
  try { const c = document.createElement("canvas"); c.width = 320; c.height = 180; c.getContext("2d").drawImage(canvas, 0, 0, 320, 180); const url = c.toDataURL("image/jpeg", 0.6); const arr = JSON.parse(localStorage.getItem("wm_scrapbook") || "[]"); arr.push(url); localStorage.setItem("wm_scrapbook", JSON.stringify(arr.slice(-40))); } catch (_) {}
}
const host = {
  moments: MOMENTS,
  // silent capture — collects into the Scrapbook without downloading (a download
  // pops OS UI that can pause the tab and stall the call). Export later.
  snapMoment: () => {
    canvas.toBlob((b) => { if (!b) return; const url = URL.createObjectURL(b); MOMENTS.push({ url }); if (MOMENTS.length > 60) URL.revokeObjectURL(MOMENTS.shift().url); }, "image/jpeg", 0.88);
    persistThumb();
  },
  // explicit download (📸 button)
  snapshot: (name) => {
    canvas.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = (name || "webcam-magic") + ".png"; a.click(); });
    persistThumb();
  },
  // Non-blocking text prompt. NEVER use window.prompt during a call — it freezes
  // the whole tab (stops packets), so the partner sees a silent link and reconnects.
  ask: (label, opts = {}) => new Promise((resolve) => {
    const wrap = document.createElement("div"); wrap.className = "ask-modal";
    const field = opts.multiline ? "<textarea rows='6'></textarea>" : "<input type='text' />";
    wrap.innerHTML = `<div class="ask-card"><label>${label}</label>${field}<div class="ask-row"><button class="ask-cancel">Cancel</button><button class="ask-ok">OK</button></div></div>`;
    document.body.appendChild(wrap);
    const f = wrap.querySelector(opts.multiline ? "textarea" : "input");
    if (opts.value) f.value = opts.value; setTimeout(() => f.focus(), 30);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.querySelector(".ask-ok").onclick = () => done(f.value);
    wrap.querySelector(".ask-cancel").onclick = () => done(null);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
    f.addEventListener("keydown", (e) => { if (e.key === "Enter" && !opts.multiline) done(f.value); if (e.key === "Escape") done(null); });
  }),
};
const games = createGames(net, host);

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

const FACE_SMILE = ["✨", "⭐", "💫", "🌟", "🌸"];

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
    bumpStreak(true);
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
    if (loveMeter >= 1 && !loveMaxed) { loveMaxed = true; FX.flood(0, W, ["💖", "🎆", "✨", "💞"], 90, true); FX.burst(W / 2, H / 2, ["🎆", "💖"], 40, 520); FX.Sound.chime(); FX.banner(W / 2, H * 0.4, "soulmates 💞"); }
  } else { loveMeter = Math.max(0, loveMeter - dt * 0.12); if (loveMeter <= 0) loveMaxed = false; }

  // 💋 kiss meter — both pucker at once
  edge("mutualKiss", localG.face.kiss > G.TUNE.kiss && remoteG.face.kiss > G.TUNE.kiss, () => {
    FX.burst(MID, H * 0.4, ["💋", "❤️", "💕", "💗"], 26, 420); FX.addShake(0.25); FX.Sound.chime();
    kissesToday = bumpDaily("wm_kiss"); FX.banner(MID, H * 0.32, `💋 kiss #${kissesToday}`);
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
  else if (m.t === "ritual") doRitual(m.kind, false);
}
function doRitual(kind, send) {
  const map = { morning: ["good morning ☀️", ["☀️", "🌻", "✨"], "sun"], afternoon: ["hey you ☀️", ["😊", "💕", "✨"], "sun"], night: ["good night 🌙", ["🌙", "⭐", "💫"], "stars"] };
  const r = map[kind] || map.morning;
  FX.banner(W / 2, H * 0.3, r[0]); FX.flood(0, W, r[1], 24); FX.setWeather(r[2], 0.7); FX.Sound.chime();
  if (send) net.send({ t: "ritual", kind });
}
function sendRitual() { const h = new Date().getHours(); doRitual(h < 12 ? "morning" : h < 18 ? "afternoon" : "night", true); }
function fireConfetti() { FX.confetti(MID * 0.5, H * 0.4, 18); FX.confetti(MID * 1.5, H * 0.4, 18); FX.Sound.chime(); net.send({ t: "confetti" }); }

// 💑 days-together counter
function refreshAnniv() {
  const el = $("anniv"); if (!el) return;
  let d = null; try { d = localStorage.getItem("wm_anniv"); } catch (_) {}
  if (!d) { el.textContent = "💑 set date"; return; }
  const days = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));
  el.textContent = `💑 ${days} days`;
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
  if (el) { el.textContent = `💞 x${combo}` + (dayStreak > 1 ? ` · 🔥 ${dayStreak}d` : ""); el.classList.remove("hidden"); }
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
let analyser = null, beatBuf = null, beatEMA = 0, lastTotal = 0, clapCd = 0;
function initBeat(stream) {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const src = a.createMediaStreamSource(stream);
    analyser = a.createAnalyser(); analyser.fftSize = 256; beatBuf = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
  } catch (_) {}
}
function stepBeat() {
  if (!analyser) return;
  analyser.getByteFrequencyData(beatBuf);
  let sum = 0; for (let i = 0; i < 24; i++) sum += beatBuf[i];      // low-end energy
  const e = sum / (24 * 255);
  beatEMA = beatEMA * 0.9 + e * 0.1;
  FX.setBeat(Math.max(0, Math.min(1, (e - beatEMA) * 4)));          // transient above moving average
  // clap / cheer detection — sharp broadband spike (free mode only)
  let tot = 0; for (let i = 0; i < beatBuf.length; i++) tot += beatBuf[i]; tot /= beatBuf.length * 255;
  if (clapCd > 0) clapCd--;
  if (games.mode === "free" && fxOn && clapCd === 0 && tot - lastTotal > 0.16 && tot > 0.34) { clapCd = 30; FX.burst(W / 2, H * 0.4, ["👏", "🎉"], 12, 320); FX.Sound.applause(); }
  lastTotal = tot;
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
    ctx.drawImage(video, (MID - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#0d1018"; ctx.fillRect(side * MID, 0, MID, H);
    ctx.fillStyle = "#566"; ctx.font = "20px system-ui"; ctx.textAlign = "center";
    ctx.fillText("waiting for partner…", side * MID + MID / 2, H / 2);
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
  // 👁 global: close your eyes for a moment, then the photo snaps just AFTER you
  // reopen them (so your eyes are open in the shot). Silent — saved to Scrapbook.
  if (eyeCapOn && localG.face.present) {
    const closed = localG.face.blink > 0.55;
    if (closed) { eyeClosedT += dt; if (eyeClosedT > 0.4) eyeArmed = true; eyeReopen = -1; }
    else {
      eyeClosedT = 0;
      if (eyeArmed) {
        eyeReopen = eyeReopen < 0 ? 0 : eyeReopen + dt;
        if (eyeReopen > 0.25) { eyeArmed = false; eyeReopen = -1; snapCount++; host.snapMoment(); FX.flash(); FX.banner(W / 2, H * 0.28, `📸 saved! (${snapCount})`); FX.Sound.pop(); }
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

  stepBeat(); updateAmbient();
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
  if (games.mode === "free") drawFreeOverlay(ctx); else games.draw(ctx);
  FX.drawParticles(ctx); FX.drawOverlays(ctx);
  drawCursors();
}
const _dummy = G.blankState();
function nullDummy() { return _dummy; }

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
      setConn("connected 💚");
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
function setConn(t) { $("connPill").textContent = t; $("connPill2").textContent = t; }
const SCREENS = ["lobby", "menu", "ready", "play"];
function show(id) { SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== id)); playing = (id === "play"); }

let pendingMode = "free";
function navTo(screen, mode, fromNet) {
  if (mode) pendingMode = mode;
  if (screen === "play") enterPlay(pendingMode);
  else if (screen === "ready") { showReady(pendingMode); show("ready"); }
  else show("menu");
  if (!fromNet && inCall) net.send({ t: "nav", screen, mode: pendingMode });
}
function enterPlay(mode) {
  if (mode.startsWith("fx:")) { soloFx = mode.slice(3); games.setMode("free"); }   // single Free feature
  else { soloFx = null; games.setMode(mode); }
  FX.clearParticles();
  $("modePill").textContent = (MODE_INFO[mode] ? MODE_INFO[mode].ic + " " + MODE_INFO[mode].nm : mode);
  const bar = $("actionbar"); bar.innerHTML = "";
  (MODE_ACTIONS[mode] || []).forEach(([a, label]) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => games.action(a); bar.appendChild(b); });
  bar.classList.toggle("hidden", !MODE_ACTIONS[mode]);
  show("play");
}
function showReady(mode) {
  const m = MODE_INFO[mode] || { ic: "✨", nm: mode, how: [] };
  $("readyIcon").textContent = m.ic; $("readyName").textContent = m.nm;
  $("readyHow").innerHTML = m.how.map((h) => `<li>${h}</li>`).join("");
}

// =====================================================================
//  MODE INFO (icon, name, category, how-to — shown before the game)
// =====================================================================
const MODE_INFO = {
  free: { ic: "✨", nm: "Free Play", cat: "Free play", how: ["Smile → sparkles, kiss → flying lips, laugh → screen shakes", "👋 wave, ✌️ peace, 👍/👎, 🤟 rock-on, 👉 point = laser, 🤙 finger-guns = confetti", "🫶 make a heart with both hands → hearts flood", "Frame your face = vignette, clap = applause, snap = spotlight", "Together: reach the centre to hold hands • both smile = rainbow • both heart = eruption"] },
  share: { ic: "📎", nm: "Share", cat: "Create", how: ["Add an image, a PDF, or capture a window/screen", "Pinch to grab & move it", "Two hands: spread = resize, twist = rotate", "Open-palm swipe to flip PDF pages"] },
  toys: { ic: "🧸", nm: "Toys", cat: "Create", how: ["Pinch to grab & throw objects", "Open palm = magnet", "Two hands: spread = resize, twist = rotate", "Shake your head to scatter • drop one on your nose to wear it"] },
  draw: { ic: "✏️", nm: "Draw", cat: "Create", how: ["Pinch to paint together on a shared canvas", "Use “clear” to wipe it"] },
  stamp: { ic: "🏷️", nm: "Stamp", cat: "Create", how: ["Pinch to drop a sticker", "“next” cycles the sticker"] },
  stars: { ic: "✨", nm: "Our Stars", cat: "Create", how: ["Pinch to place a star on the night sky", "Together you draw a constellation"] },
  oursong: { ic: "🎶", nm: "Our Song", cat: "Create", how: ["Name your song", "Play it out loud — the vinyl & bars dance to the beat"] },
  scrapbook: { ic: "📔", nm: "Scrapbook", cat: "Create", how: ["Close your eyes (or use Photo Booth) to snap moments — they save here", "◀ ▶ to flip • ⬇ save to download to your Photos"] },
  catch: { ic: "🍓", nm: "Catch", cat: "Games", how: ["Treats fall from the top", "Catch them with your hand — most catches wins"] },
  pop: { ic: "🫧", nm: "Pop", cat: "Games", how: ["Bubbles float up", "Point your finger to pop them"] },
  hockey: { ic: "🏒", nm: "Air Hockey", cat: "Games", how: ["Your palm is the paddle", "Block the puck and knock it past your partner"] },
  rps: { ic: "✊", nm: "Rock Paper Scissors", cat: "Games", how: ["Press “go” for a 3·2·1 countdown", "Throw ✊ fist / ✋ palm / ✌️ scissors"] },
  dontlaugh: { ic: "😐", nm: "Don't Laugh", cat: "Games", how: ["First one to smile or laugh loses…", "…and gets a clown filter 🤡"] },
  mirror: { ic: "🪞", nm: "Mirror Me", cat: "Games", how: ["Match the pose shown before time runs out", "Score as many as you can"] },
  tictactoe: { ic: "#️⃣", nm: "Tic-Tac-Toe", cat: "Games", how: ["Take turns — pinch a cell to place your mark", "First three in a row wins"] },
  thumbwar: { ic: "👍", nm: "Thumb War", cat: "Games", how: ["Both hold a 👍", "Hold it to push the thumb to your partner's side & pin them"] },
  dancebattle: { ic: "🕺", nm: "Dance Battle", cat: "Games", how: ["A move is called out each round", "Match it in time — score vs your partner"] },
  synctest: { ic: "💘", nm: "Sync Test", cat: "Games", how: ["A cute question appears", "Both answer with a finger count — match = in sync!"] },
  photobooth: { ic: "📸", nm: "Photo Booth", cat: "Games", how: ["Press for a 3·2·1 countdown", "Strike a pose — it saves a framed photo to your Scrapbook"] },
  target: { ic: "🎯", nm: "Target Track", cat: "Games", how: ["A ring drifts around your side", "Keep your fingertip on it — most seconds-on-target wins"] },
  simon: { ic: "🙈", nm: "Simon Says", cat: "Games", how: ["Do the pose ONLY when it says “Simon says”", "Do it on a trick round and you miss the point"] },
  balloon: { ic: "🎈", nm: "Keepy-Up", cat: "Games", how: ["A balloon falls on your side", "Bat it up with your hand — most hits before it drops wins"] },
  reaction: { ic: "⚡", nm: "Reaction Duel", cat: "Games", how: ["Wait for it…", "Make a ✊ the instant it says GO — fastest wins the round"] },
  winkbattle: { ic: "😉", nm: "Wink Duel", cat: "Games", how: ["Wait for GO, then 😉 wink", "First to wink wins the round"] },
  charades: { ic: "🎭", nm: "Charades", cat: "Games", how: ["“new prompt” → act it out silently with gestures & face", "Partner guesses out loud • “reveal” the answer"] },
  freeze: { ic: "🧊", nm: "Freeze", cat: "Games", how: ["On FREEZE, hold perfectly still", "Move your hands and you're out — last still wins"] },
  rhythm: { ic: "🥁", nm: "Rhythm", cat: "Games", how: ["A circle pulses to a beat", "👏 clap in time — score for on-beat claps"] },
  wish: { ic: "🙏", nm: "Make a Wish", cat: "Couple", how: ["Both press your palms together 🙏", "A shooting star grants your shared wish"] },
  handsup: { ic: "🙌", nm: "Hands Up!", cat: "Couple", how: ["Both raise your hands at the same time", "Hype counter goes up with confetti 🥳"] },
  q36: { ic: "💞", nm: "36 Questions", cat: "Talk & connect 💬", how: ["The famous set that “leads to love” (Arthur Aron)", "Take turns answering honestly • end with 4 min eye contact 👀"] },
  deeptalk: { ic: "💬", nm: "Deep Talk", cat: "Talk & connect 💬", how: ["A gentle connection prompt each time", "Take turns answering"] },
  twentyq: { ic: "🙋", nm: "20 Questions", cat: "Talk & connect 💬", how: ["One of you thinks of something", "The other asks up to 20 yes/no questions to guess it"] },
  twotruths: { ic: "🕵️", nm: "Two Truths & a Lie", cat: "Talk & connect 💬", how: ["Write two truths and a lie about yourself", "Partner guesses which is the lie"] },
  story: { ic: "📖", nm: "Story Builder", cat: "Talk & connect 💬", how: ["Build a silly story together", "Take turns adding one sentence each"] },
  telepathy: { ic: "🧠", nm: "Telepathy", cat: "Talk & connect 💬", how: ["A category appears — both name the same thing", "Match = you're on the same wavelength 🎉"] },
  connect4: { ic: "🔴", nm: "Connect Four", cat: "Games", how: ["Take turns — point to a column & pinch to drop", "First to line up four wins"] },
  memory: { ic: "🧠", nm: "Memory Match", cat: "Games", how: ["Take turns flipping two cards (point & pinch)", "Find a pair to score and go again"] },
  trivia: { ic: "🧩", nm: "Trivia", cat: "Games", how: ["A question with 3 options appears", "Both answer by holding up 1, 2, or 3 fingers"] },
  vault: { ic: "🔒", nm: "The Vault", cat: "Games", how: ["Co-op! Each of you sees only HALF the code", "Tell each other, then one of you enters all 4 digits"] },
  howwell: { ic: "🤔", nm: "How Well Do You Know Me", cat: "Talk & connect 💬", how: ["One answers a question about themselves (secret)", "The other guesses — see if you match"] },
  whomore: { ic: "⚖️", nm: "Who's More Likely", cat: "Talk & connect 💬", how: ["A cheeky prompt appears", "Both vote ☝️ you / ✌️ me — agree or debate 😆"] },
  thisorthat: { ic: "🔀", nm: "This or That", cat: "Talk & connect 💬", how: ["Quick-fire preferences", "Pick ☝️ left / ✌️ right — build a match streak"] },
  hangman: { ic: "🔡", nm: "Hangman", cat: "Talk & connect 💬", how: ["One sets a secret word", "The other guesses letters before the hearts run out"] },
  kisscam: { ic: "💋", nm: "Kiss Cam", cat: "Couple", how: ["Press start for a countdown", "Both pucker up for the smooch cam 💕"] },
  mashup: { ic: "💞", nm: "Name Mash", cat: "Couple", how: ["Enter both your names", "Get your couple name"] },
  lovecalc: { ic: "❤️", nm: "Love Calc", cat: "Couple", how: ["Enter both names", "See your (very flattering) compatibility %"] },
  spinner: { ic: "🎡", nm: "Date Spinner", cat: "Couple", how: ["Spin for a random date-night idea"] },
  pictionary: { ic: "🎨", nm: "Pictionary", cat: "Couple", how: ["One person: “new word”, then pinch to draw it", "The other: say it out loud or type a guess"] },
  mailbox: { ic: "💌", nm: "Mailbox", cat: "Couple", how: ["“write” a love note → delivered to your partner", "Saved here so you can re-read them"] },
  bucket: { ic: "🪣", nm: "Bucket List", cat: "Couple", how: ["“add” things to do together", "Pinch an item to check it off (synced)"] },
  dressup: { ic: "👒", nm: "Dress-Up", cat: "Couple", how: ["Cycle through hats", "Match your partner's hat to twin 👯"] },
  truthdare: { ic: "😈", nm: "Truth or Dare", cat: "After dark 🌶️", how: ["Press truth or dare for a flirty prompt", "Read it out and do it 😏"] },
  pickup: { ic: "💘", nm: "Pick-up Lines", cat: "After dark 🌶️", how: ["Press for a flirty line / pick-up", "Delivered to your partner too 😘"] },
  dareroulette: { ic: "🌶️", nm: "Dare Roulette", cat: "After dark 🌶️", how: ["Spin the wheel of bold dares", "Whatever it lands on… you do 😈"] },
  loversdice: { ic: "🎲", nm: "Lovers' Dice", cat: "After dark 🌶️", how: ["Roll for an action × a spot", "e.g. “slow-kiss the neck” — act it out 😏"] },
  wyr: { ic: "😏", nm: "Would You Rather", cat: "After dark 🌶️", how: ["A flirty this-or-that appears", "Vote with fingers: ☝️ left, ✌️ right — see if you match"] },
  never: { ic: "🙈", nm: "Never Have I Ever", cat: "After dark 🌶️", how: ["A spicy confession appears each round", "Say 'I have' or 'I haven't' 😏"] },
  slowdance: { ic: "💃", nm: "Slow Dance", cat: "Chill", how: ["Warm romantic ambiance", "Play music and sway — hearts pulse to the beat"] },
  mood: { ic: "🕯️", nm: "Mood", cat: "Chill", how: ["Candlelit ambiance, just the two of you"] },
  breathing: { ic: "🧘", nm: "Breathe", cat: "Chill", how: ["Follow the ring — in, hold, out", "Breathe together to relax"] },
  karaoke: { ic: "🎤", nm: "Karaoke", cat: "Chill", how: ["Paste some lyrics", "They scroll like a teleprompter"] },
  countdown: { ic: "⏳", nm: "Countdown", cat: "Chill", how: ["Set the date you'll next meet", "It counts down the days 🥹"] },
};
// each Free effect, playable on its own (mode id "fx:<id>")
const FEATURES = [
  ["smile", "😀", "Sparkle Smile", "Smile → sparkles rain (bigger smile = more)"],
  ["kiss", "💋", "Flying Kisses", "Pucker/kiss → lips fly from your mouth"],
  ["brow", "😮", "Shock", "Raise your eyebrows → 😮 and a pop"],
  ["blink", "😉", "Camera Flash", "Hard blink → flash + a 📸 snapshot"],
  ["tongue", "😝", "Raspberry", "Stick your tongue out → 😜 + raspberry"],
  ["laugh", "😂", "Laugh Riot", "Open-mouth laugh → 😂 balloons + screen shake"],
  ["frown", "☔", "Rain Cloud", "Frown → a rain cloud parks over your head"],
  ["zoned", "💤", "Zzz", "Zone out → a 💤 floats up"],
  ["wave", "👋", "Glitter Wave", "Open-hand wave → a glitter trail + 'hi!'"],
  ["guns", "🤙", "Finger Guns", "Finger-guns → confetti shots"],
  ["peace", "✌️", "Peace Rain", "✌️ peace → peace signs rain down"],
  ["thumbsup", "👍", "Thumbs Up", "👍 → a big +1 floats up"],
  ["thumbsdown", "👎", "Thumbs Down", "👎 → boo + tomatoes"],
  ["rockon", "🤟", "Rock On", "🤟 → flames + concert lights + riff"],
  ["snap", "🫰", "Spotlight", "Snap pose → a spotlight on you"],
  ["point", "👉", "Laser Pointer", "Point → a laser dot follows your finger"],
  ["clap", "👏", "Applause", "Clap your hands → applause + 👏"],
  ["frame", "🖼️", "Glam Vignette", "Frame your face with both hands → vignette"],
  ["circle", "🔮", "Orb", "Make a circle with both hands → a glowing orb"],
  ["squish", "🤏", "Cheek Squish", "Cup your face with both hands → squiish"],
];
const CAT_ORDER = ["Free play", "Single effects 🎯", "Create", "Games", "Couple", "Talk & connect 💬", "Chill", "After dark 🌶️"];
for (const [id, ic, nm, how] of FEATURES) MODE_INFO["fx:" + id] = { ic, nm, cat: "Single effects 🎯", how: [how, "It's the only effect on — everything else is off."] };
const MODE_ACTIONS = {
  share: [["image", "🖼 image"], ["pdf", "📄 pdf"], ["window", "🪟 window"], ["prev", "◀"], ["next", "▶"], ["remove", "🗑"]],
  toys: [["gravity", "gravity"], ["spawn", "+toy"], ["clear", "clear"]],
  draw: [["clear", "clear"]], stamp: [["next", "next"], ["clear", "clear"]],
  rps: [["start", "go"]], photobooth: [["shoot", "📸 3·2·1"]], synctest: [["go", "go"]], spinner: [["spin", "🎡 spin"]],
  dressup: [["next", "👒 next hat"], ["off", "off"]], truthdare: [["truth", "💬 truth"], ["dare", "🔥 dare"]], tictactoe: [["reset", "↺ reset"]],
  mashup: [["go", "💞 mash"]], countdown: [["set", "📅 set date"]],
  pictionary: [["word", "🎨 new word"], ["guess", "🗣 guess"], ["reveal", "👀 reveal"], ["clear", "clear"]],
  karaoke: [["lyrics", "🎤 lyrics"], ["restart", "↺"]], kisscam: [["start", "💋 start"]], pickup: [["go", "💘 line"]],
  oursong: [["set", "🎶 name it"]], mailbox: [["write", "💌 write"]], stars: [["clear", "clear"]], lovecalc: [["calc", "❤️ calc"]],
  scrapbook: [["prev", "◀"], ["next", "▶"], ["save", "⬇ save"], ["clear", "🗑"]], bucket: [["add", "➕ add"], ["clear", "🗑"]],
  dareroulette: [["spin", "🌶️ spin"]], loversdice: [["roll", "🎲 roll"]], wyr: [["go", "go"]], never: [["next", "🙈 next"]],
  charades: [["new", "🎭 new prompt"], ["reveal", "👀 reveal"]], freeze: [["start", "🧊 start"]],
  q36: [["prev", "◀"], ["next", "▶"]], deeptalk: [["next", "💬 next"]],
  twentyq: [["ask", "➕ asked"], ["swap", "🔄 swap"], ["reset", "↺"]],
  twotruths: [["enter", "✍️ enter"], ["reveal", "👀 reveal"]],
  story: [["add", "✍️ add"], ["clear", "🗑"]], telepathy: [["go", "🧠 new"], ["answer", "✍️ answer"]],
  vault: [["new", "🔒 new code"], ["enter", "🔢 enter"]], connect4: [["reset", "↺ reset"]], memory: [["reset", "↺ reset"]],
  trivia: [["go", "🧩 go"]], howwell: [["go", "🤔 new"], ["answer", "✍️ answer"]], whomore: [["go", "⚖️ go"]], thisorthat: [["go", "🔀 go"]],
  hangman: [["set", "🔡 set word"], ["guess", "🔠 guess"]],
};
function buildMenu() {
  const grid = $("menuGrid"); if (grid.dataset.built) return; grid.dataset.built = "1";
  for (const cat of CAT_ORDER) {
    const title = document.createElement("div"); title.className = "cat-title"; title.textContent = cat; grid.appendChild(title);
    for (const id in MODE_INFO) if (MODE_INFO[id].cat === cat) {
      const m = MODE_INFO[id], card = document.createElement("div"); card.className = "card-mode";
      card.innerHTML = `<div class="ic">${m.ic}</div><div class="nm">${m.nm}</div>`;
      card.onclick = () => navTo("ready", id);
      grid.appendChild(card);
    }
  }
}

// =====================================================================
//  BOOT + UI WIRING
// =====================================================================
async function boot(callMode) {
  $("lobbyHint").textContent = "Loading magic… (hand + face models, ~few MB, once)";
  try {
    await initModels();
    const stream = await startCamera();
    initBeat(stream); loadStreak(); buildDebug(); refreshAnniv(); buildMenu();
    inCall = !!callMode;
    if (callMode) connect($("roomInput").value.trim(), stream); else setConn("solo");
    show("menu");
    requestAnimationFrame(loop);
  } catch (e) { $("lobbyHint").textContent = "Couldn't start: " + (e.message || e) + " — allow camera & use https/localhost."; }
}

const copyLink = async (el) => { try { await navigator.clipboard.writeText(location.href); const o = el.textContent; el.textContent = "✓ copied"; setTimeout(() => (el.textContent = o), 1500); } catch (_) {} };
$("joinBtn").addEventListener("click", () => {
  if (!$("roomInput").value.trim()) { $("roomInput").focus(); return; }
  const u = new URL(location.href); u.searchParams.set("room", $("roomInput").value.trim()); history.replaceState(null, "", u);
  boot(true);
});
$("soloBtn").addEventListener("click", () => boot(false));
$("copyLinkBtn").addEventListener("click", (e) => copyLink(e.target));
$("copyLink2").addEventListener("click", (e) => copyLink(e.target));
$("tuneBtn").addEventListener("click", () => $("debug").classList.toggle("hidden"));
$("anniv").addEventListener("click", setAnniv);
// ready screen
$("readyStart").addEventListener("click", () => navTo("play", pendingMode));
$("readyBack").addEventListener("click", () => navTo("menu"));
// play screen controls
$("menuBtn").addEventListener("click", () => navTo("menu"));
$("fxBtn").addEventListener("click", (e) => { fxOn = !fxOn; e.target.style.opacity = fxOn ? 1 : 0.45; });
$("snapBtn").addEventListener("click", () => host.snapshot("webcam-magic"));
function reflectEye() { const b = $("eyeBtn"); b.style.opacity = eyeCapOn ? 1 : 0.4; b.title = eyeCapOn ? "Close your eyes to snap a photo (on)" : "Eye-capture off"; }
$("eyeBtn").addEventListener("click", () => { eyeCapOn = !eyeCapOn; try { localStorage.setItem("wm_eyecap", eyeCapOn ? "1" : "0"); } catch (_) {} reflectEye(); });
reflectEye();
$("leaveBtn").addEventListener("click", () => location.reload());
$("loveBtn2").addEventListener("click", sendSweet);
$("confettiBtn2").addEventListener("click", fireConfetti);
const SIZES = ["s", "m", "l"];
$("sizeBtn").addEventListener("click", (e) => { const cur = $("stage").dataset.size, n = SIZES[(SIZES.indexOf(cur) + 1) % 3]; $("stage").dataset.size = n; e.target.textContent = "⤢ " + n.toUpperCase(); });

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

const pre = new URL(location.href).searchParams.get("room");
if (pre) { $("roomInput").value = pre; $("copyLinkBtn").classList.remove("hidden"); }
$("roomInput").addEventListener("input", () => $("copyLinkBtn").classList.toggle("hidden", !$("roomInput").value.trim()));
