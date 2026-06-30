// Webcam Magic — frontend-only gesture & face "party" for two.
// Pipeline: webcam -> MediaPipe (hands + face) -> gesture state -> particle FX.
// Networking: Trystero (mqtt + torrent), reused from WatchTogether. No backend.
// The local feed is detected here; the partner sends a compact gesture packet,
// so each side only ever runs MediaPipe on its OWN camera.

import { HandLandmarker, FaceLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const HAND_MODEL  = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL  = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const $ = (id) => document.getElementById(id);
const canvas = $("canvas"), ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height, MID = W / 2;
const localVideo = $("localVideo"), remoteVideo = $("remoteVideo");

let handLM = null, faceLM = null;
let inCall = false, fxOn = true;
let frame = 0, lastFps = performance.now(), fpsCount = 0;

// ---- gesture state shared between the two sides ----------------------------
// All points are "display-normalized" [0..1] in a single (mirrored) half.
function blankG() {
  return { present: false, smile: 0, kiss: 0, laugh: 0, heart: false,
           palm: null, mouth: null, wave: false, peace: false, thumbs: false };
}
const localG = blankG();
let remoteG = blankG();
let haveRemoteVideo = false;

// =====================================================================
//  PARTICLE SYSTEM
// =====================================================================
const particles = [];
const MAX_P = 1400;
let shake = 0;

function add(p) { if (particles.length < MAX_P) particles.push(p); }
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);

function emoji(x, y, vx, vy, ch, size, life, gravity = 600) {
  add({ x, y, vx, vy, ch, size, life, max: life, rot: rnd(-0.5, 0.5),
        vr: rnd(-3, 3), g: gravity, scaleIn: true });
}
// rising flood from the bottom of a region [x0,x1]
function flood(x0, x1, chars, count, big = false) {
  for (let i = 0; i < count; i++)
    emoji(rnd(x0, x1), H + rnd(0, 120), rnd(-40, 40), rnd(-520, -340),
          pick(chars), big ? rnd(46, 80) : rnd(26, 46), rnd(2.4, 3.8), 120);
}
function burst(x, y, chars, count, spd = 380) {
  for (let i = 0; i < count; i++) {
    const a = rnd(0, Math.PI * 2), s = rnd(spd * 0.4, spd);
    emoji(x, y, Math.cos(a) * s, Math.sin(a) * s, pick(chars), rnd(28, 48), rnd(1.0, 2.0), 500);
  }
}
// directed spray (e.g. kisses flying toward the other half)
function spray(x, y, dir, chars, count) {
  for (let i = 0; i < count; i++)
    emoji(x, y, dir * rnd(260, 520), rnd(-220, 60), pick(chars), rnd(30, 52), rnd(1.6, 2.6), 120);
}
function sparkle(x, y) {
  emoji(x + rnd(-50, 50), y + rnd(-50, 50), rnd(-30, 30), rnd(-60, 40),
        pick(["✨", "⭐", "💫", "🌟"]), rnd(16, 30), rnd(0.8, 1.6), 220);
}

function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
  }
}
function drawParticles() {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const p of particles) {
    const t = p.life / p.max;
    const grow = p.scaleIn ? Math.min(1, (1 - t) * 4) : 1;     // little pop-in
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2.2);                    // fade near death
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.font = `${p.size * (0.6 + 0.4 * grow)}px serif`;
    ctx.fillText(p.ch, 0, 0);
    ctx.restore();
  }
}

// =====================================================================
//  GESTURE MATH
// =====================================================================
const HEART_EMO = ["❤️", "💖", "💕", "💗", "💘", "💞", "🩷"];
const KISS_EMO  = ["💋", "😘", "💗", "💕"];
const SPARK_EMO = ["✨", "⭐", "💫", "🌟", "🌸"];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// which fingers are extended, via distance-from-wrist heuristic (orientation-free)
function fingersUp(lm) {
  const w = lm[0];
  const up = (tip, pip) => dist(lm[tip], w) > dist(lm[pip], w);
  return {
    thumb:  dist(lm[4], w) > dist(lm[2], w) * 1.05,
    index:  up(8, 6), middle: up(12, 10), ring: up(16, 14), pinky: up(20, 18),
  };
}
function classify(lm) {
  const f = fingersUp(lm);
  const cnt = (f.index + f.middle + f.ring + f.pinky);
  if (f.thumb && cnt === 0) return "thumbs";
  if (f.index && f.middle && !f.ring && !f.pinky) return "peace";
  if (cnt >= 4) return "palm";
  return "";
}
// two hands forming a heart: index tips meet (top), thumb tips meet (bottom)
function isHeart(hands) {
  if (hands.length < 2) return false;
  const [a, b] = hands;
  const handSize = (dist(a[0], a[9]) + dist(b[0], b[9])) / 2 || 1;
  const idxGap = dist(a[8], b[8]) / handSize;
  const thbGap = dist(a[4], b[4]) / handSize;
  const idxY = (a[8].y + b[8].y) / 2, thbY = (a[4].y + b[4].y) / 2;
  return idxGap < 0.7 && thbGap < 1.0 && idxY < thbY;
}

// =====================================================================
//  LOCAL DETECTION  (runs MediaPipe on our own camera)
// =====================================================================
let lastVideoTime = -1, palmHist = null;

function detectLocal() {
  if (!handLM || localVideo.readyState < 2) return;
  if (localVideo.currentTime === lastVideoTime) return;
  lastVideoTime = localVideo.currentTime;
  const ts = performance.now();

  // hands
  const hr = handLM.detectForVideo(localVideo, ts);
  const hands = (hr.landmarks || []);
  localG.present = hands.length > 0;
  localG.heart = isHeart(hands);

  // classify gestures + palm point
  localG.peace = false; localG.thumbs = false; localG.palm = null;
  let palmPt = null;
  for (const lm of hands) {
    const g = classify(lm);
    if (g === "peace") localG.peace = true;
    if (g === "thumbs") localG.thumbs = true;
    if (g === "palm") palmPt = { x: 1 - lm[9].x, y: lm[9].y }; // mirrored, normalized
  }
  // wave = open palm moving sideways
  localG.wave = false;
  if (palmPt) {
    localG.palm = palmPt;
    if (palmHist) {
      const vx = Math.abs(palmPt.x - palmHist.x);
      if (vx > 0.012) localG.wave = true;
    }
    palmHist = palmPt;
  } else palmHist = null;

  // face (throttled to every other frame for performance)
  if (faceLM && frame % 2 === 0) {
    const fr = faceLM.detectForVideo(localVideo, ts + 0.5);
    const bs = fr.faceBlendshapes && fr.faceBlendshapes[0];
    const lms = fr.faceLandmarks && fr.faceLandmarks[0];
    if (bs && lms) {
      const get = (n) => { const c = bs.categories.find((c) => c.categoryName === n); return c ? c.score : 0; };
      localG.smile = (get("mouthSmileLeft") + get("mouthSmileRight")) / 2;
      localG.kiss  = get("mouthPucker");
      localG.laugh = (get("jawOpen") > 0.35 && localG.smile > 0.25) ? 1 : 0;
      const up = lms[13], lo = lms[14];                        // inner lip centers
      localG.mouth = { x: 1 - (up.x + lo.x) / 2, y: (up.y + lo.y) / 2 };
    } else {
      localG.smile = localG.kiss = localG.laugh = 0; localG.mouth = null;
    }
  }
}

// =====================================================================
//  RENDER + EFFECTS
// =====================================================================
const prev = { localKiss: false, remoteKiss: false, localPeace: false,
               remotePeace: false, localThumbs: false, remoteThumbs: false,
               localLaugh: false, remoteLaugh: false, mutualHeart: false };
let lastChime = 0;

// map a display-normalized point into a half: side 0 = left, 1 = right
function toCanvas(pt, side) {
  return { x: side * MID + pt.x * MID, y: pt.y * H };
}

function drawFeed(video, side, has) {
  ctx.save();
  ctx.beginPath(); ctx.rect(side * MID, 0, MID, H); ctx.clip();
  if (has && video.readyState >= 2) {
    ctx.translate(side * MID + MID, 0); ctx.scale(-1, 1);       // selfie-mirror each half
    // cover-fit the video into the half
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    const scale = Math.max(MID / vw, H / vh);
    const dw = vw * scale, dh = vh * scale;
    ctx.drawImage(video, (MID - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#0d1018"; ctx.fillRect(side * MID, 0, MID, H);
    ctx.fillStyle = "#566"; ctx.font = "20px system-ui"; ctx.textAlign = "center";
    ctx.fillText(side === 0 ? "you" : "waiting for partner…", side * MID + MID / 2, H / 2);
  }
  ctx.restore();
}

// per-side solo effects driven by a gesture state
function sideEffects(g, side, dt) {
  if (!fxOn || !g.present && !g.mouth) return;
  const x0 = side * MID, x1 = x0 + MID;

  if (g.smile > 0.4) { if (Math.random() < g.smile) sparkle(toCanvas({ x: 0.5, y: 0.35 }, side).x, rnd(0, H * 0.5)); }
  if (g.wave && g.palm) { const p = toCanvas(g.palm, side); for (let i = 0; i < 2; i++) sparkle(p.x, p.y); }

  if (g.heart) {                                              // solo heart -> gentle flood your side
    if (Math.random() < 0.6) flood(x0, x1, HEART_EMO, 4);
  }
}

// edge-triggered (fire-once) effects
function edgeEffects() {
  const lm = (g, side, prevKey, fn) => {
    if (g && !prev[prevKey]) fn(side);
    prev[prevKey] = !!g;
  };
  // kisses fly toward the OTHER side
  lm(localG.kiss > 0.5, 0, "localKiss", () => {
    const p = localG.mouth ? toCanvas(localG.mouth, 0) : { x: MID * 0.5, y: H * 0.4 };
    spray(p.x, p.y, +1, KISS_EMO, 14);
  });
  lm(remoteG.kiss > 0.5, 1, "remoteKiss", () => {
    const p = remoteG.mouth ? toCanvas(remoteG.mouth, 1) : { x: MID * 1.5, y: H * 0.4 };
    spray(p.x, p.y, -1, KISS_EMO, 14);
  });
  lm(localG.peace, 0, "localPeace", (s) => burst(MID * 0.5, H * 0.4, ["✌️"], 10));
  lm(remoteG.peace, 1, "remotePeace", (s) => burst(MID * 1.5, H * 0.4, ["✌️"], 10));
  lm(localG.thumbs, 0, "localThumbs", () => emoji(MID * 0.5, H * 0.75, 0, -300, "👍", 70, 2.0, 80));
  lm(remoteG.thumbs, 1, "remoteThumbs", () => emoji(MID * 1.5, H * 0.75, 0, -300, "👍", 70, 2.0, 80));
  lm(localG.laugh, 0, "localLaugh", () => { burst(MID * 0.5, H * 0.4, ["😂"], 16); shake = 0.35; });
  lm(remoteG.laugh, 1, "remoteLaugh", () => { burst(MID * 1.5, H * 0.4, ["😂"], 16); shake = 0.35; });

  // ✦ the headline: BOTH making a heart at once -> full-screen eruption ✦
  const reallyMutual = localG.heart && inCall && remoteG.heart;
  if (reallyMutual && !prev.mutualHeart) {
    flood(0, W, HEART_EMO, 120, true);
    burst(W / 2, H / 2, HEART_EMO, 40, 520);
    shake = 0.5; chime();
  }
  prev.mutualHeart = reallyMutual;
}

// tiny WebAudio chime (no asset needed)
let actx = null;
function chime() {
  const now = performance.now();
  if (now - lastChime < 800) return; lastChime = now;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320, 1760].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.type = "sine";
      o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime + i * 0.08;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t); o.stop(t + 0.5);
    });
  } catch (_) {}
}

function loop() {
  const t = performance.now();
  const dt = Math.min(0.05, (t - (loop._last || t)) / 1000); loop._last = t;
  frame++;

  detectLocal();

  // camera shake decays
  shake *= 0.86; if (shake < 0.01) shake = 0;
  const sx = shake ? rnd(-1, 1) * 18 * shake : 0, sy = shake ? rnd(-1, 1) * 18 * shake : 0;

  ctx.setTransform(1, 0, 0, 1, sx, sy);
  ctx.clearRect(-30, -30, W + 60, H + 60);

  drawFeed(localVideo, 0, true);
  drawFeed(remoteVideo, 1, inCall && haveRemoteVideo);
  // soft seam
  ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(MID - 1, 0, 2, H);

  sideEffects(localG, 0, dt);
  if (inCall && remoteG.present) sideEffects(remoteG, 1, dt);
  edgeEffects();

  stepParticles(dt);
  drawParticles();

  // fps
  fpsCount++;
  if (t - lastFps > 500) { $("fpsPill").textContent = Math.round(fpsCount * 1000 / (t - lastFps)) + " fps"; fpsCount = 0; lastFps = t; }
  // gesture readout
  const tags = [];
  if (localG.heart) tags.push("🫶"); if (localG.smile > 0.4) tags.push("😀");
  if (localG.kiss > 0.5) tags.push("😘"); if (localG.wave) tags.push("👋");
  if (localG.peace) tags.push("✌️"); if (localG.thumbs) tags.push("👍");
  $("gesturePill").textContent = tags.length ? tags.join(" ") : "—";

  requestAnimationFrame(loop);
}

// =====================================================================
//  MEDIAPIPE INIT
// =====================================================================
async function initModels() {
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM);
  handLM = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
    runningMode: "VIDEO", numHands: 2,
  });
  faceLM = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
    runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,
  });
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: "user" }, audio: true,
  });
  localVideo.srcObject = stream;
  await localVideo.play();
  return stream;
}

// =====================================================================
//  NETWORKING (Trystero — mqtt + torrent, reused from WatchTogether)
// =====================================================================
function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
const roomId = (word) => "wm" + hashStr(word.trim().toLowerCase());

let entries = [], primary = null, sendGesture = null, localStream = null;
const sharedTracks = new Set();

function connect(word, stream) {
  if (typeof Trystero === "undefined") { setConn("net failed"); return; }
  localStream = stream;
  const cfg = { appId: "webcam-magic", relayConfig: { redundancy: 6 } };
  const rid = roomId(word);
  const strategies = [
    { name: "mqtt", join: Trystero.mqtt && Trystero.mqtt.joinRoom },
    { name: "torrent", join: Trystero.torrent && Trystero.torrent.joinRoom },
  ];
  setConn("connecting…");
  strategies.forEach((s) => {
    if (typeof s.join !== "function") return;
    let r; try { r = s.join(cfg, rid); } catch (_) { return; }
    const [sendG, getG] = r.makeAction("g");
    const entry = { name: s.name, room: r, sendG, connected: false };
    getG((data) => { remoteG = Object.assign(blankG(), data); remoteG.present = true; });
    r.onPeerJoin = (pid) => {
      entry.connected = true;
      if (!primary) { primary = entry; sendGesture = (o) => entries.forEach((e) => e.connected && e.sendG(o)); }
      reshare(r, pid);
      setConn("connected 💚");
    };
    r.onPeerLeave = () => {
      entry.connected = false;
      if (!entries.some((e) => e.connected)) { remoteG = blankG(); haveRemoteVideo = false; setConn("waiting…"); }
    };
    r.onPeerStream = (st) => { remoteVideo.srcObject = st; remoteVideo.play().catch(()=>{}); haveRemoteVideo = true; };
    r.onPeerTrack  = (tr, st) => { remoteVideo.srcObject = st; remoteVideo.play().catch(()=>{}); haveRemoteVideo = true; };
    entries.push(entry);
  });
  // share our camera+mic with everyone who joins
  setConn("waiting…");
}
function reshare(room, pid) {
  if (!localStream) return;
  localStream.getTracks().forEach((t) => {
    try { room.addTrack(t, localStream, pid); } catch (_) {}
  });
}
function leave() {
  entries.forEach((e) => { try { e.room.leave(); } catch (_) {} });
  entries = []; primary = null; sendGesture = null; remoteG = blankG(); haveRemoteVideo = false;
}
window.addEventListener("beforeunload", leave);

// throttled gesture broadcast (~12/s) — compact packet only
setInterval(() => {
  if (!sendGesture) return;
  sendGesture({
    present: localG.present, smile: +localG.smile.toFixed(2), kiss: +localG.kiss.toFixed(2),
    laugh: localG.laugh, heart: localG.heart, peace: localG.peace, thumbs: localG.thumbs,
    wave: localG.wave, palm: localG.palm, mouth: localG.mouth,
  });
}, 80);

// =====================================================================
//  UI WIRING
// =====================================================================
function setConn(txt) { $("connPill").textContent = txt; }

async function boot(callMode) {
  $("lobbyHint").textContent = "Loading magic… (downloading hand & face models, ~few MB, once)";
  try {
    await initModels();
    const stream = await startCamera();
    $("lobby").classList.add("hidden");
    $("hud").classList.remove("hidden");
    if (callMode) {
      inCall = true;
      const word = $("roomInput").value.trim();
      connect(word, stream);
    } else { inCall = false; setConn("solo"); }
    requestAnimationFrame(loop);
  } catch (e) {
    $("lobbyHint").textContent = "Couldn't start: " + (e.message || e) + " — allow camera & use https/localhost.";
  }
}

$("joinBtn").addEventListener("click", () => {
  if (!$("roomInput").value.trim()) { $("roomInput").focus(); return; }
  // reflect room in URL so the invite link carries it
  const u = new URL(location.href); u.searchParams.set("room", $("roomInput").value.trim());
  history.replaceState(null, "", u);
  boot(true);
});
$("soloBtn").addEventListener("click", () => boot(false));
$("copyLinkBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  $("copyLinkBtn").textContent = "✓ Copied!";
  setTimeout(() => ($("copyLinkBtn").textContent = "🔗 Copy invite link"), 1500);
});
$("legendBtn").addEventListener("click", () => $("legend").classList.toggle("hidden"));
$("legendClose").addEventListener("click", () => $("legend").classList.add("hidden"));
$("muteFxBtn").addEventListener("click", (e) => { fxOn = !fxOn; e.target.style.opacity = fxOn ? 1 : 0.4; });
$("snapBtn").addEventListener("click", () => {
  canvas.toBlob((b) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = "webcam-magic.png"; a.click();
  });
});
$("leaveBtn").addEventListener("click", () => location.reload());

// prefill room from invite link
const pre = new URL(location.href).searchParams.get("room");
if (pre) { $("roomInput").value = pre; $("copyLinkBtn").classList.remove("hidden"); }
$("roomInput").addEventListener("input", () => $("copyLinkBtn").classList.toggle("hidden", !$("roomInput").value.trim()));
