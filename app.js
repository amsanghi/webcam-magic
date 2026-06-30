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
const games = createGames(net);

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

const FACE_SMILE = ["✨", "⭐", "💫", "🌟", "🌸"];

function sideEffects(g, side, dt) {
  if (!fxOn) return;
  const F = g.face || {};
  const P = g.poses || {};
  const at = (pt) => toCanvas(pt, side);
  const halfX = side === 0 ? MID * 0.5 : MID * 1.5;

  // ---- held toggles (section 3 frame->vignette, section 2 snap->spotlight)
  FX.setVignette(side, !!g.two.frame);
  FX.setSpotlight(side, P.snap && g.palm ? g.palm : null);

  // ---- continuous ----
  if (F.smile > 0.4 && Math.random() < F.smile) FX.sparkleAt(halfX + FX.rnd(-120, 120), FX.rnd(40, H * 0.55), 1);
  if (g.wave && g.palm) { const p = at(g.palm); FX.sparkleAt(p.x, p.y, 2); }
  if (P.rockOn) for (const h of g.hands) { const p = at(h); FX.emoji(p.x, p.y, FX.rnd(-40, 40), -FX.rnd(120, 240), "🔥", FX.rnd(26, 40), 0.7, 200); }
  if (F.frown > 0.45 && Math.random() < 0.3) { const cx = F.nose ? at(F.nose).x : halfX; FX.emoji(cx + FX.rnd(-70, 70), H * 0.25, 0, FX.rnd(120, 200), "💧", 22, 1.4, 300); }

  // ---- edge bursts (section 1 face) ----
  edge("kiss" + side, F.kiss > 0.5, () => {
    const p = F.mouth ? at(F.mouth) : { x: halfX, y: H * 0.4 };
    FX.spray(p.x, p.y, side === 0 ? 1 : -1, ["💋", "😘", "💗", "💕"], 14);
    if (inCall && side === 0) net.send({ t: "fog" });        // fogs partner's screen
  });
  edge("brow" + side, F.brow > 0.6, () => { const p = F.nose ? at(F.nose) : { x: halfX, y: H * .35 }; FX.burst(p.x, p.y - 60, ["😮", "❗"], 8, 240); });
  edge("blink" + side, F.blink > 0.55, () => { FX.flash(); FX.emoji(halfX, H * 0.3, FX.rnd(-30, 30), 120, "📸", 56, 2.2, 120); });
  edge("tongue" + side, F.tongue > 0.4, () => { FX.burst(F.mouth ? at(F.mouth).x : halfX, H * 0.42, ["😜", "🤪"], 8, 220); FX.Sound.raspberry(); });
  edge("laugh" + side, !!F.laugh, () => { FX.burst(halfX, H * 0.42, ["😂"], 16, 360); FX.addShake(0.4); });
  edge("frown" + side, F.frown > 0.55, () => FX.Sound.sad());
  edge("zoned" + side, !!F.zoned, () => FX.emoji(halfX, H * 0.35, FX.rnd(-20, 20), -120, "💤", 44, 2.4, 60));

  // ---- edge bursts (section 2 single-hand) ----
  edge("guns" + side, P.fingerGuns, () => { const p = g.point.active ? at(g.point) : { x: halfX, y: H * .4 }; FX.confetti(p.x, p.y, 16); FX.Sound.snap(); });
  edge("peace" + side, P.peace, () => FX.burst(halfX, H * 0.4, ["✌️"], 10, 260));
  edge("thumbUp" + side, P.thumbsUp, () => FX.plusOne(halfX, H * 0.7, "👍"));
  edge("thumbDn" + side, P.thumbsDown, () => { FX.plusOne(halfX, H * 0.7, "👎"); FX.burst(halfX, H * 0.5, ["🍅"], 8, 240); FX.Sound.boo(); });
  edge("rock" + side, P.rockOn, () => FX.Sound.riff());

  // ---- edge bursts (section 3 two-hand) ----
  edge("clap" + side, g.two.clap, () => { FX.burst(halfX, H * 0.45, ["👏"], 12, 300); FX.Sound.applause(); });
  edge("circle" + side, g.two.circle.active, () => { const p = at({ x: g.two.circle.x, y: g.two.circle.y }); FX.ring(p.x, p.y, "#9b6bff"); FX.burst(p.x, p.y, ["🔮", "✨"], 10, 200); });
}

function drawFreeOverlay(ctx) {
  // laser pointer (section 2: point)
  for (const [g, side] of [[localG, 0], [inCall ? remoteG : null, 1]]) {
    if (g && g.point && g.point.active) {
      const p = toCanvas(g.point, side);
      ctx.save(); ctx.shadowColor = "#ff3b3b"; ctx.shadowBlur = 16; ctx.fillStyle = "#ff3b3b";
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill(); ctx.restore();
    }
  }
}

// couple cross-feed effects (section 4)
function coupleEffects(dt) {
  if (!inCall) return;
  // mutual heart -> eruption
  edge("mutualHeart", localG.two.heart && remoteG.two.heart, () => {
    FX.flood(0, W, ["❤️", "💖", "💕", "💗", "💞", "🩷"], 120, true);
    FX.burst(W / 2, H / 2, ["❤️", "💖", "💕"], 40, 520); FX.addShake(0.5); FX.Sound.chime();
    combo++;
  });
  // synchronized smile -> rainbow
  edge("syncSmile", localG.face.smile > 0.45 && remoteG.face.smile > 0.45, () => { FX.triggerRainbow(); FX.Sound.chime(); });

  // hands meeting at the seam: high-five (edge) + hold-hands link (held)
  const lHand = nearSeam(localG, 0), rHand = nearSeam(remoteG, 1);
  const meeting = lHand && rHand && Math.abs(lHand.y - rHand.y) < 0.22;
  edge("highfive", meeting, () => { FX.burst(MID, ((lHand.y + rHand.y) / 2) * H, ["🙌", "✋", "✨"], 16, 360); FX.addShake(0.3); FX.Sound.pop(); });
  if (meeting) FX.link(MID - 4, lHand.y * H, MID + 4, rHand.y * H);

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
  for (const h of g.hands) if (h.x > 0.82 && (!best || h.x > best.x)) best = h;
  return best;
}

// fog received from partner's blown kiss (section 4)
let fogTime = 0;
function handleFreeNet(m) {
  if (m.t === "fog") { FX.setFog(0, true); fogTime = 3; }
}

// =====================================================================
//  RENDER
// =====================================================================
function drawFeed(video, side, has) {
  ctx.save();
  ctx.beginPath(); ctx.rect(side * MID, 0, MID, H); ctx.clip();
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
  if (fogTime > 0) { fogTime -= dt; if (localG.pinch.active) { const p = toCanvas(localG.pinch, 0); FX.wipeFog(0, p.x / MID, p.y / H); } else if (localG.palm) FX.wipeFog(0, localG.palm.x, localG.palm.y); if (fogTime <= 0) FX.setFog(0, false); }

  const sh = FX.getShake();
  ctx.setTransform(1, 0, 0, 1, sh.x, sh.y);
  ctx.clearRect(-30, -30, W + 60, H + 60);

  drawFeed(localVideo, 0, true);
  drawFeed(remoteVideo, 1, inCall && haveRemoteVideo);
  ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(MID - 1, 0, 2, H);

  if (games.mode === "free") {
    sideEffects(localG, 0, dt);
    if (inCall && remoteG.present) sideEffects(remoteG, 1, dt);
    coupleEffects(dt);
  } else {
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
  return { k: "g", present: g.present, wave: g.wave, poses: g.poses,
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
    get((data) => { if (data && data.k === "g") { remoteG = Object.assign(G.blankState(), data); remoteG.present = true; } else { games.onNet(data); handleFreeNet(data); } });
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

// mode bar
const MODE_ACTIONS = {
  toys: [["gravity", "gravity"], ["spawn", "+toy"], ["clear", "clear"]],
  draw: [["clear", "clear"]],
  stamp: [["next", "next"], ["clear", "clear"]],
  rps: [["start", "go"]],
};
function selectMode(name, btn) {
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
