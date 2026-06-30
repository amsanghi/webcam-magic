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

let handLM = null, faceLM = null;
let inCall = false, fxOn = true, amInitiator = true, haveRemoteVideo = false;
let frame = 0, lastFps = performance.now(), fpsCount = 0, lastVideoTime = -1;
let combo = 0;

let localG = G.blankState(), remoteG = G.blankState();

// ---- networking handle passed into games ----------------------------------
const net = { send: (o) => { if (sendMsg) sendMsg(o); } };
let sendMsg = null;
const host = { snapshot: (name) => canvas.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = (name || "webcam-magic") + ".png"; a.click(); }) };
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
  const halfX = side === 0 ? MID * 0.5 : MID * 1.5;

  // ---- held toggles (frame->vignette, snap->spotlight, rock-on->concert) --
  FX.setVignette(side, !!g.two.frame);
  FX.setSpotlight(side, P.snap && g.palm ? g.palm : null);
  FX.setConcert(side, P.rockOn);

  // 🤏 cheek-squish: two hands hugging the face → squeeze the feed
  let squishing = false;
  if (F.nose && g.hands && g.hands.length >= 2) {
    const near = g.hands.filter((h) => Math.abs(h.x - F.nose.x) < 0.28 && h.y > F.nose.y - 0.18 && h.y < F.nose.y + 0.25);
    squishing = near.length >= 2;
  }
  squishTarget[side] = squishing ? 1 : 0;
  edge("squish" + side, squishing, () => { FX.banner(halfX, H * 0.22, "squiish~ 😆"); FX.Sound.boing(); FX.burst(halfX, H * 0.4, ["😆", "💕"], 6, 160); });

  // ---- continuous ----
  if (F.smile > T.smile) {
    if (Math.random() < F.smile) FX.sparkleAt(halfX + FX.rnd(-120, 120), FX.rnd(40, H * 0.55), 1);
    if (F.smile > 0.85 && Math.random() < 0.3) FX.confetti(halfX, H * 0.3, 6);   // denser at big smile
  }
  if (g.wave && g.palm) { const p = at(g.palm); FX.sparkleAt(p.x, p.y, 2); }
  if (P.rockOn) for (const h of g.hands) { const p = at(h); FX.emoji(p.x, p.y, FX.rnd(-40, 40), -FX.rnd(120, 240), "🔥", FX.rnd(26, 40), 0.7, 200); }
  if (F.frown > T.frown - 0.1 && Math.random() < 0.4) { const cx = F.nose ? at(F.nose).x : halfX; FX.emoji(cx + FX.rnd(-70, 70), H * 0.2, 0, FX.rnd(140, 220), "💧", 22, 1.5, 320); }

  // ---- edge bursts: face (section 1) ----
  edge("kiss" + side, F.kiss > T.kiss, () => {
    const src = F.mouth ? at(F.mouth) : { x: halfX, y: H * 0.4 };
    FX.spray(src.x, src.y, side === 0 ? 1 : -1, ["💋", "😘", "💗", "💕"], 10);
    if (inCall) {                                            // air-kiss travels across + blush
      const oSide = side === 0 ? 1 : 0, oG = side === 0 ? remoteG : localG;
      FX.travel(src, () => oG.face.nose ? toCanvas(oG.face.nose, oSide) : { x: oSide * MID + MID / 2, y: H * 0.4 }, "💋",
        (d) => { FX.blush(d.x, d.y); FX.burst(d.x, d.y, ["💗", "💕"], 6, 160); FX.Sound.pop(); });
      if (side === 0) { net.send({ t: "fog" }); bumpStreak(); }
    }
  });
  edge("brow" + side, F.brow > T.brow, () => { const p = F.nose ? at(F.nose) : { x: halfX, y: H * .35 }; FX.burst(p.x, p.y - 60, ["😮", "❗"], 8, 240); });
  edge("blink" + side, F.blink > T.blink, () => { FX.flash(); FX.emoji(side === 0 ? 40 : W - 40, 60, 0, 0, "📸", 60, 2.2, 30); });
  edge("tongue" + side, F.tongue > T.tongue, () => { FX.burst(F.mouth ? at(F.mouth).x : halfX, H * 0.42, ["😜", "🤪"], 8, 220); FX.Sound.raspberry(); });
  edge("laugh" + side, !!F.laugh, () => { FX.burst(halfX, H * 0.42, ["😂"], 14, 360); FX.balloons(halfX, 6); FX.addShake(0.4); });
  edge("frown" + side, F.frown > T.frown, () => FX.Sound.sad());
  edge("zoned" + side, !!F.zoned, () => { FX.emoji(halfX, H * 0.35, FX.rnd(-20, 20), -120, "💤", 44, 2.4, 60); FX.Sound.sad(); });

  // ---- edge bursts: one hand (section 2) ----
  edge("guns" + side, P.fingerGuns, () => { const p = g.point.active ? at(g.point) : { x: halfX, y: H * .4 }; FX.confetti(p.x, p.y, 16); FX.Sound.snap(); });
  edge("peace" + side, P.peace, () => { for (let i = 0; i < 10; i++) FX.emoji(halfX + FX.rnd(-MID / 2 + 40, MID / 2 - 40), -FX.rnd(0, 120), FX.rnd(-30, 30), FX.rnd(120, 200), "✌️", FX.rnd(26, 40), FX.rnd(2, 3), 200); });
  edge("thumbUp" + side, P.thumbsUp, () => FX.plusOne(halfX, H * 0.7, "👍"));
  edge("thumbDn" + side, P.thumbsDown, () => { FX.plusOne(halfX, H * 0.7, "👎"); FX.burst(halfX, H * 0.5, ["🍅"], 8, 240); FX.Sound.boo(); });
  edge("rock" + side, P.rockOn, () => FX.Sound.riff());
  edge("wave" + side, g.wave, () => FX.banner(halfX, H * 0.22, "hi! 👋"));

  // ---- edge bursts: two hands (section 3) ----
  edge("clap" + side, g.two.clap, () => { FX.burst(halfX, H * 0.45, ["👏"], 12, 300); FX.Sound.applause(); });
  edge("circle" + side, g.two.circle.active, () => {
    const p = at({ x: g.two.circle.x, y: g.two.circle.y });
    FX.ring(p.x, p.y, "#9b6bff"); FX.burst(p.x, p.y, ["🔮", "✨"], 8, 180);
    if (side === 0) tossSpawn(p.x, p.y, "🔮");               // conjure a tossable orb
  });
}

function drawFreeOverlay(ctx) {
  for (const [g, side] of [[localG, 0], [inCall ? remoteG : null, 1]]) {
    if (!g) continue;
    // laser pointer (section 2: point)
    if (g.point && g.point.active) {
      const p = toCanvas(g.point, side);
      ctx.save(); ctx.shadowColor = "#ff3b3b"; ctx.shadowBlur = 16; ctx.fillStyle = "#ff3b3b";
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill(); ctx.restore();
    }
    // frown rain cloud parked over the head (section 1)
    if (g.face && g.face.frown > G.TUNE.frown && g.face.nose) {
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
  const p = pinching ? toCanvas(localG.pinch, 0) : null;
  if (pinching && p) {
    if (heldThrow == null) {
      let best = -1, bd = 70; throws.forEach((o, i) => { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < bd) { bd = d; best = i; } });
      heldThrow = best >= 0 ? best : tossSpawn(p.x, p.y, "💖");
    }
    const o = throws[heldThrow];
    if (o) { o.vx = heldPrev ? (p.x - heldPrev.x) / dt : 0; o.vy = heldPrev ? (p.y - heldPrev.y) / dt : 0; o.x = p.x; o.y = p.y; }
    heldPrev = p;
  } else { heldThrow = null; heldPrev = null; }
  const myMouth = localG.face && localG.face.mouth ? toCanvas(localG.face.mouth, 0) : null;
  for (let i = throws.length - 1; i >= 0; i--) {
    const o = throws[i]; if (i === heldThrow) continue;
    o.vy += 700 * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.vx *= 0.995;
    if (o.y > H - o.s / 2) { o.y = H - o.s / 2; o.vy *= -0.5; o.vx *= 0.8; }
    if (o.x < o.s / 2) { o.x = o.s / 2; o.vx *= -0.6; }
    // 🍰 feed-me: an incoming throwable that reaches your mouth gets "eaten"
    if (myMouth && Math.hypot(o.x - myMouth.x, o.y - myMouth.y) < 55) { FX.burst(myMouth.x, myMouth.y, ["😋", "💕"], 8, 180); FX.Sound.pop(); throws.splice(i, 1); continue; }
    if (inCall && o.x > MID) { net.send({ t: "toss", yN: o.y / H, ch: o.ch }); throws.splice(i, 1); continue; }   // hand off to partner
    if (!inCall && o.x > W - o.s / 2) { o.x = W - o.s / 2; o.vx *= -0.6; }
  }
}
function tossDraw(ctx) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const o of throws) { ctx.save(); ctx.font = `${o.s}px serif`; ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 8; ctx.fillText(o.ch, o.x, o.y); ctx.restore(); }
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
    const p = toCanvas(remoteG.face.nose, 1); FX.emoji(p.x, p.y, 0, 0, "👉", 50, 0.8, 0); FX.ring(p.x, p.y, "#ffd2e0"); FX.Sound.pop();
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
  else if (m.t === "toss") throws.push({ x: MID - 20, y: (m.yN || 0.5) * H, vx: -300, vy: -120, ch: m.ch || "💖", s: 46 });
  else if (m.t === "love-msg") { FX.banner(W / 2, H * 0.3, m.text || "💌"); FX.flood(0, W, ["💕", "💗"], 20); FX.Sound.chime(); }
  else if (m.t === "confetti") { FX.confetti(MID * 0.5, H * 0.4, 18); FX.confetti(MID * 1.5, H * 0.4, 18); }
}
function fireConfetti() { FX.confetti(MID * 0.5, H * 0.4, 18); FX.confetti(MID * 1.5, H * 0.4, 18); FX.Sound.chime(); net.send({ t: "confetti" }); }

// 💑 days-together counter
function refreshAnniv() {
  const el = $("anniv"); if (!el) return;
  let d = null; try { d = localStorage.getItem("wm_anniv"); } catch (_) {}
  if (!d) { el.textContent = "💑 set date"; return; }
  const days = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5));
  el.textContent = `💑 ${days} days`;
}
function setAnniv() {
  const cur = (() => { try { return localStorage.getItem("wm_anniv") || ""; } catch (_) { return ""; } })();
  const v = prompt("Your anniversary / first date (YYYY-MM-DD):", cur);
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
}
let analyser = null, beatBuf = null, beatEMA = 0;
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
    if (side === 0) { ctx.translate(MID, 0); ctx.scale(-1, 1); }   // local: selfie mirror
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    const sc = Math.max(MID / vw, H / vh), dw = vw * sc, dh = vh * sc;
    const ox = side === 0 ? (MID - dw) / 2 : MID + (MID - dw) / 2;
    ctx.drawImage(video, ox, (H - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#0d1018"; ctx.fillRect(side * MID, 0, MID, H);
    ctx.fillStyle = "#566"; ctx.font = "20px system-ui"; ctx.textAlign = "center";
    ctx.fillText(side === 0 ? "you" : "waiting for partner…", side * MID + MID / 2, H / 2);
  }
  ctx.restore();
}

function drawCursors() {
  for (const [g, side] of [[localG, 0], [inCall ? remoteG : null, 1]]) {
    if (!g) continue;
    for (const h of (g.hands || [])) {
      const p = toCanvas(h, side);
      ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7); ctx.stroke(); ctx.restore();
    }
  }
}

function loop() {
  const t = performance.now();
  const dt = Math.min(0.05, (t - (loop._last || t)) / 1000); loop._last = t; frame++;

  detectLocal(dt);
  squish[0] += (squishTarget[0] - squish[0]) * 0.25; squish[1] += (squishTarget[1] - squish[1]) * 0.25;
  if (fogTime > 0) { fogTime -= dt; if (localG.pinch.active) { const p = toCanvas(localG.pinch, 0); FX.wipeFog(0, p.x / MID, p.y / H); } else if (localG.palm) FX.wipeFog(0, localG.palm.x, localG.palm.y); if (fogTime <= 0) FX.setFog(0, false); }

  const sh = FX.getShake();
  ctx.setTransform(1, 0, 0, 1, sh.x, sh.y);
  ctx.clearRect(-30, -30, W + 60, H + 60);

  drawFeed(localVideo, 0, true);
  drawFeed(remoteVideo, 1, inCall && haveRemoteVideo);
  ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(MID - 1, 0, 2, H);

  stepBeat(); updateAmbient();
  if (games.mode === "free") {
    sideEffects(localG, 0, dt);
    if (inCall && remoteG.present) sideEffects(remoteG, 1, dt);
    coupleEffects(dt); tossUpdate(dt);
  } else {
    squishTarget[0] = squishTarget[1] = 0;
    games.update(dt, localG, inCall ? remoteG : nullDummy());
  }

  FX.stepScreen(dt); FX.stepParticles(dt); FX.stepOverlays(dt);
  FX.drawScreen(ctx);
  if (games.mode === "free") drawFreeOverlay(ctx); else games.draw(ctx);
  FX.drawParticles(ctx); FX.drawOverlays(ctx);
  drawCursors();

  // HUD
  fpsCount++;
  if (t - lastFps > 500) { $("fpsPill").textContent = Math.round(fpsCount * 1000 / (t - lastFps)) + " fps"; fpsCount = 0; lastFps = t; }
  $("gesturePill").textContent = readout(localG);
  requestAnimationFrame(loop);
}
const _dummy = G.blankState();
function nullDummy() { return _dummy; }

function readout(g) {
  const x = [];
  if (g.two.heart) x.push("🫶"); if (g.face.smile > 0.4) x.push("😀"); if (g.face.kiss > 0.5) x.push("😘");
  if (g.wave) x.push("👋"); if (g.poses.peace) x.push("✌️"); if (g.poses.thumbsUp) x.push("👍");
  if (g.poses.rockOn) x.push("🤟"); if (g.poses.point) x.push("👉"); if (g.poses.fist) x.push("✊");
  return x.length ? x.join(" ") : "—";
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
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: true });
  localVideo.srcObject = stream; await localVideo.play(); return stream;
}

function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
const roomId = (w) => "wm" + hashStr(w.trim().toLowerCase());
let entries = [], primary = null, localStream = null;

function packet() {
  const g = localG;
  return { k: "g", present: g.present, wave: g.wave, fingers: g.fingers, poses: g.poses,
    pinch: g.pinch, point: g.point, palm: g.palm, hands: g.hands, two: g.two,
    face: { present: g.face.present, smile: +g.face.smile.toFixed(2), kiss: +g.face.kiss.toFixed(2),
            brow: +g.face.brow.toFixed(2), frown: +g.face.frown.toFixed(2), blink: +g.face.blink.toFixed(2),
            tongue: +g.face.tongue.toFixed(2), laugh: g.face.laugh, zoned: g.face.zoned, nose: g.face.nose, mouth: g.face.mouth } };
}

function connect(word, stream) {
  if (typeof Trystero === "undefined") { setConn("net failed"); return; }
  localStream = stream;
  const cfg = { appId: "webcam-magic", relayConfig: { redundancy: 6 } };
  const rid = roomId(word);
  const strats = [{ name: "mqtt", join: Trystero.mqtt && Trystero.mqtt.joinRoom }, { name: "torrent", join: Trystero.torrent && Trystero.torrent.joinRoom }];
  setConn("connecting…");
  strats.forEach((s) => {
    if (typeof s.join !== "function") return;
    let r; try { r = s.join(cfg, rid); } catch (_) { return; }
    const [send, get] = r.makeAction("m");
    const entry = { room: r, send, connected: false };
    get((data) => {
      if (data && data.k === "g") { remoteG = Object.assign(G.blankState(), data); remoteG.present = true; }
      else {
        if (data && typeof data.t === "string" && data.t.startsWith("share-") && games.mode !== "share") selectMode("share");
        games.onNet(data); handleFreeNet(data);
      }
    });
    r.onPeerJoin = (pid) => {
      entry.connected = true;
      amInitiator = String(Trystero.selfId) > String(pid);
      games.setAuthority(amInitiator);
      if (!primary) { primary = entry; sendMsg = (o) => entries.forEach((e) => e.connected && e.send(o)); }
      if (localStream) localStream.getTracks().forEach((tr) => { try { r.addTrack(tr, localStream, pid); } catch (_) {} });
      setConn("connected 💚");
    };
    r.onPeerLeave = () => { entry.connected = false; if (!entries.some((e) => e.connected)) { remoteG = G.blankState(); haveRemoteVideo = false; setConn("waiting…"); } };
    r.onPeerStream = (st) => { remoteVideo.srcObject = st; remoteVideo.play().catch(() => {}); haveRemoteVideo = true; };
    r.onPeerTrack = (tr, st) => { remoteVideo.srcObject = st; remoteVideo.play().catch(() => {}); haveRemoteVideo = true; };
    entries.push(entry);
  });
  setConn("waiting…");
}
window.addEventListener("beforeunload", () => entries.forEach((e) => { try { e.room.leave(); } catch (_) {} }));

setInterval(() => { if (sendMsg) sendMsg(packet()); }, 80);

// =====================================================================
//  UI
// =====================================================================
function setConn(t) { $("connPill").textContent = t; }

async function boot(callMode) {
  $("lobbyHint").textContent = "Loading magic… (hand + face models, ~few MB, once)";
  try {
    await initModels();
    const stream = await startCamera();
    initBeat(stream); loadStreak(); buildDebug(); refreshAnniv();
    $("lobby").classList.add("hidden"); $("hud").classList.remove("hidden"); $("modebar").classList.remove("hidden");
    if (callMode) { inCall = true; connect($("roomInput").value.trim(), stream); }
    else { inCall = false; setConn("solo"); }
    requestAnimationFrame(loop);
  } catch (e) { $("lobbyHint").textContent = "Couldn't start: " + (e.message || e) + " — allow camera & use https/localhost."; }
}

$("joinBtn").addEventListener("click", () => {
  if (!$("roomInput").value.trim()) { $("roomInput").focus(); return; }
  const u = new URL(location.href); u.searchParams.set("room", $("roomInput").value.trim()); history.replaceState(null, "", u);
  boot(true);
});
$("soloBtn").addEventListener("click", () => boot(false));
$("copyLinkBtn").addEventListener("click", async () => { await navigator.clipboard.writeText(location.href); $("copyLinkBtn").textContent = "✓ Copied!"; setTimeout(() => ($("copyLinkBtn").textContent = "🔗 Copy invite link"), 1500); });
$("legendBtn").addEventListener("click", () => $("legend").classList.toggle("hidden"));
$("legendClose").addEventListener("click", () => $("legend").classList.add("hidden"));
$("muteFxBtn").addEventListener("click", (e) => { fxOn = !fxOn; e.target.style.opacity = fxOn ? 1 : 0.4; });
$("snapBtn").addEventListener("click", () => canvas.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "webcam-magic.png"; a.click(); }));
$("leaveBtn").addEventListener("click", () => location.reload());
$("tuneBtn").addEventListener("click", () => $("debug").classList.toggle("hidden"));
$("loveBtn").addEventListener("click", sendSweet);
$("confettiBtn").addEventListener("click", fireConfetti);
$("anniv").addEventListener("click", setAnniv);
let adultOn = false;
$("adultBtn").addEventListener("click", (e) => {
  if (!adultOn && !confirm("Enable the 18+ flirty deck? (suggestive, playful — nothing explicit)")) return;
  adultOn = !adultOn; games.setAdult(adultOn);
  e.target.style.opacity = adultOn ? 1 : 0.5; e.target.title = adultOn ? "18+ flirty deck ON" : "18+ flirty deck off";
});

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

// mode bar
const MODE_ACTIONS = {
  share: [["image", "🖼 image"], ["pdf", "📄 pdf"], ["window", "🪟 window"], ["prev", "◀"], ["next", "▶"], ["remove", "🗑"]],
  toys: [["gravity", "gravity"], ["spawn", "+toy"], ["clear", "clear"]],
  draw: [["clear", "clear"]],
  stamp: [["next", "next"], ["clear", "clear"]],
  rps: [["start", "go"]],
  photobooth: [["shoot", "📸 3·2·1"]],
  synctest: [["go", "go"]],
  spinner: [["spin", "🎡 spin"]],
  dressup: [["next", "👒 next hat"], ["off", "off"]],
  truthdare: [["truth", "💬 truth"], ["dare", "🔥 dare"]],
  tictactoe: [["reset", "↺ reset"]],
  mashup: [["go", "💞 mash"]],
  countdown: [["set", "📅 set date"]],
  pictionary: [["word", "🎨 new word"], ["reveal", "👀 reveal"], ["clear", "clear"]],
  karaoke: [["lyrics", "🎤 lyrics"], ["restart", "↺"]],
  kisscam: [["start", "💋 start"]],
  pickup: [["go", "💘 line"]],
};
function selectMode(name, btn) {
  btn = btn || document.querySelector(`#modebar .mode[data-mode="${name}"]`);
  games.setMode(name); FX.clearParticles();
  document.querySelectorAll("#modebar .mode").forEach((b) => b.classList.toggle("on", b === btn));
  const bar = $("actionbar"); bar.innerHTML = "";
  (MODE_ACTIONS[name] || []).forEach(([a, label]) => { const b = document.createElement("button"); b.className = "ghost wide"; b.textContent = label; b.onclick = () => games.action(a); bar.appendChild(b); });
  bar.classList.toggle("hidden", !(MODE_ACTIONS[name]));
}
document.querySelectorAll("#modebar .mode").forEach((b) => b.addEventListener("click", () => selectMode(b.dataset.mode, b)));

const pre = new URL(location.href).searchParams.get("room");
if (pre) { $("roomInput").value = pre; $("copyLinkBtn").classList.remove("hidden"); }
$("roomInput").addEventListener("input", () => $("copyLinkBtn").classList.toggle("hidden", !$("roomInput").value.trim()));
