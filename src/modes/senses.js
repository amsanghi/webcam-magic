// senses.js — New senses: voice, objects, pose, silhouette, colour, pitch, loudness, location, phone sensors, keyboard, mouse/touch.
import { FX, net, host, authority, meIdx, W, H, MID, toCanvas, rnd, pick, clamp, cursor, cursorPx, activeCur, roundRect, pill, outline, fit, hint, scoreboard, big } from "./_shared.js";


// ================= NEW SENSES (voice / objects / phone sensors) =========
// 🗣️ SAY IT FIRST — first to SAY the word out loud (Web Speech API)
export function sayItMode() {
  const WORDS = ["banana", "pizza", "dragon", "sunshine", "kangaroo", "chocolate", "umbrella", "penguin", "rainbow", "butterfly", "spaghetti", "dinosaur", "coconut", "avocado"];
  let target = "", phase = "idle", score = [0, 0], winner = -1, claimed = false, t = 0;
  const bcast = () => net.send({ t: "sf", tg: target, s: score, w: winner, ph: phase });
  const newRound = () => { target = pick(WORDS); phase = "go"; winner = -1; claimed = false; t = 8; bcast(); };
  const declare = (w) => { if (winner >= 0) return; winner = w; score[w]++; phase = "done"; t = 3; FX.confetti(w === 0 ? W / 4 : 3 * W / 4, H / 2, 20); FX.Sound.chime(); bcast(); };
  const heard = (text) => { if (phase !== "go" || claimed) return; if (target && text.includes(target)) { claimed = true; if (authority) declare(0); else net.send({ t: "sf-said" }); } };
  return {
    enter() { score = [0, 0]; phase = "idle"; if (host.voice.supported) host.voice.start(heard); },
    exit() { host.voice.stop(); },
    action(a) { if (a === "go") { if (authority) newRound(); else net.send({ t: "sf-start" }); } },
    onNet(m) { if (m.t === "sf") { target = m.tg; score = m.s; winner = m.w; phase = m.ph; claimed = m.ph !== "go"; } else if (m.t === "sf-said" && authority) declare(1); else if (m.t === "sf-start" && authority) newRound(); },
    update(dt) { if (!authority) return; if (phase === "go") { t -= dt; if (t <= 0) { phase = "done"; t = 3; bcast(); } } else if (phase === "done") { t -= dt; if (t <= 0) newRound(); } },
    draw(ctx) { scoreboard(ctx, score, null, "Say It First"); if (!host.voice.supported) return big(ctx, "🎤 use Chrome/Edge", "voice recognition isn't available in this browser"); if (phase === "idle") big(ctx, "🗣️ Say It First", "press “go” — first to SAY the word wins"); else if (phase === "go") big(ctx, "Say:  " + target, "🎤 out loud, fast!"); else big(ctx, winner < 0 ? "nobody 😅" : (winner === meIdx() ? "You said it! 🗣️" : "Partner said it"), ""); },
  };
}


// 🧩 DECIPHER — first to SAY the answer to a riddle/scramble
export function decipherMode() {
  const P = [{ c: "unscramble:  ZAPIZ", a: "pizza" }, { c: "unscramble:  NOMEL", a: "lemon" }, { c: "I have keys but open no locks…", a: "keyboard" }, { c: "Roses are red, violets are ___", a: "blue" }, { c: "What has hands but cannot clap?", a: "clock" }, { c: "unscramble:  TETUBRFLY", a: "butterfly" }, { c: "unscramble:  NGODAR", a: "dragon" }, { c: "The more of it you take, the more you leave behind", a: "footsteps" }, { c: "What gets wetter the more it dries?", a: "towel" }];
  let cur = null, phase = "idle", score = [0, 0], winner = -1, claimed = false, t = 0;
  const bcast = () => net.send({ t: "dc", c: cur, s: score, w: winner, ph: phase });
  const newRound = () => { cur = pick(P); phase = "go"; winner = -1; claimed = false; t = 15; bcast(); };
  const declare = (w) => { if (winner >= 0) return; winner = w; score[w]++; phase = "done"; t = 4; FX.confetti(w === 0 ? W / 4 : 3 * W / 4, H / 2, 24); FX.Sound.chime(); bcast(); };
  const heard = (text) => { if (phase !== "go" || claimed || !cur) return; if (text.includes(cur.a)) { claimed = true; if (authority) declare(0); else net.send({ t: "dc-said" }); } };
  return {
    enter() { score = [0, 0]; phase = "idle"; if (host.voice.supported) host.voice.start(heard); },
    exit() { host.voice.stop(); },
    action(a) { if (a === "go") { if (authority) newRound(); else net.send({ t: "dc-start" }); } },
    onNet(m) { if (m.t === "dc") { cur = m.c; score = m.s; winner = m.w; phase = m.ph; claimed = m.ph !== "go"; } else if (m.t === "dc-said" && authority) declare(1); else if (m.t === "dc-start" && authority) newRound(); },
    update(dt) { if (!authority) return; if (phase === "go") { t -= dt; if (t <= 0) { phase = "done"; t = 4; bcast(); } } else if (phase === "done") { t -= dt; if (t <= 0) newRound(); } },
    draw(ctx) { scoreboard(ctx, score, null, "Decipher"); if (!host.voice.supported) return big(ctx, "🎤 use Chrome/Edge", "voice recognition isn't available in this browser"); if (phase === "idle") big(ctx, "🧩 Decipher", "press “go” — SAY the answer first"); else if (phase === "go") big(ctx, cur.c, "🎤 say your answer!"); else big(ctx, winner < 0 ? ("it was “" + cur.a + "” 😅") : (winner === meIdx() ? "You got it! 🧩" : "Partner got it"), ""); },
  };
}


// 🔍 TREASURE HUNT — first to show the object to your camera (object detection)
export function treasureMode() {
  const T = [["🍌", "banana"], ["☕", "cup"], ["📱", "cell phone"], ["📖", "book"], ["🍾", "bottle"], ["✂️", "scissors"], ["🥄", "spoon"], ["🪑", "chair"], ["🧸", "teddy bear"], ["🕐", "clock"], ["🍎", "apple"], ["🎒", "backpack"]];
  let ti = 0, phase = "idle", score = [0, 0], winner = -1, claimed = false, t = 0;
  const bcast = () => net.send({ t: "th", i: ti, s: score, w: winner, ph: phase });
  const newRound = () => { ti = Math.floor(Math.random() * T.length); phase = "go"; winner = -1; claimed = false; t = 20; bcast(); };
  const declare = (w) => { if (winner >= 0) return; winner = w; score[w]++; phase = "done"; t = 4; FX.confetti(w === 0 ? W / 4 : 3 * W / 4, H / 2, 26); FX.Sound.chime(); bcast(); };
  return {
    enter() { score = [0, 0]; phase = "idle"; host.objects.want = true; },
    exit() { host.objects.want = false; },
    action(a) { if (a === "go") { if (authority) newRound(); else net.send({ t: "th-start" }); } },
    onNet(m) { if (m.t === "th") { ti = m.i; score = m.s; winner = m.w; phase = m.ph; claimed = m.ph !== "go"; } else if (m.t === "th-found" && authority) declare(1); else if (m.t === "th-start" && authority) newRound(); },
    update(dt) {
      if (phase === "go" && !claimed && (host.objects.labels || []).includes(T[ti][1])) { claimed = true; if (authority) declare(0); else net.send({ t: "th-found" }); }
      if (!authority) return; if (phase === "go") { t -= dt; if (t <= 0) { phase = "done"; t = 4; bcast(); } } else if (phase === "done") { t -= dt; if (t <= 0) newRound(); }
    },
    draw(ctx) { scoreboard(ctx, score, phase === "go" ? t : null, "Treasure Hunt 🔍"); if (phase === "idle") big(ctx, "🔍 Treasure Hunt", host.objects.labels ? "press “go” — grab the object fastest!" : "loading object detector…"); else if (phase === "go") big(ctx, "Bring me:  " + T[ti][0] + " " + T[ti][1], "show it to your camera! 📸"); else big(ctx, winner < 0 ? "nobody found it 😅" : (winner === meIdx() ? "You found it! 🏆" : "Partner found it"), ""); },
  };
}


// 🌍 DISTANCE — how far apart are we (GPS)
export function distanceMode() {
  let meLoc = null, them = null, km = null, err = "";
  const hav = (a, b) => { const R = 6371, tr = (x) => x * Math.PI / 180; const dLat = tr(b.lat - a.lat), dLon = tr(b.lon - a.lon); const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
  const calc = () => { if (meLoc && them) km = hav(meLoc, them); };
  return {
    async enter() { meLoc = null; them = null; km = null; err = ""; meLoc = await host.geo(); if (meLoc) net.send({ t: "geo", lat: +meLoc.lat.toFixed(3), lon: +meLoc.lon.toFixed(3) }); else err = "location blocked"; calc(); },
    onNet(m) { if (m.t === "geo") { them = { lat: m.lat, lon: m.lon }; calc(); if (meLoc) net.send({ t: "geo", lat: +meLoc.lat.toFixed(3), lon: +meLoc.lon.toFixed(3) }); } },
    draw(ctx) { if (err) return big(ctx, "🌍 " + err, "allow location to see the distance"); if (km == null) return big(ctx, "🌍 Distance", them ? "getting your location…" : "waiting for both locations…"); big(ctx, `${Math.round(km).toLocaleString()} km apart`, `≈ ${Math.round(km * 0.621).toLocaleString()} miles — but always close at heart 💞`); },
  };
}


// 📱 TILT MAZE — tilt your phone to roll the ball to the ring
export function tiltMode() {
  let ball = { x: .5, y: .5, vx: 0, vy: 0 }, target = { x: .3, y: .3 }, my = 0, their = 0, bc = 0;
  const nt = () => { target = { x: rnd(.15, .85), y: rnd(.15, .85) }; };
  return {
    enter() { ball = { x: .5, y: .5, vx: 0, vy: 0 }; my = 0; their = 0; nt(); },
    action(a) { if (a === "enable") host.requestSensors(); },
    onNet(m) { if (m.t === "tilt") their = m.s; },
    update(dt) {
      const gx = (host.sensors.gamma || 0) / 45, gy = ((host.sensors.beta || 0) - 40) / 45;
      ball.vx += gx * dt * 0.9; ball.vy += gy * dt * 0.9; ball.vx *= 0.9; ball.vy *= 0.9;
      ball.x = clamp(ball.x + ball.vx * dt, .05, .95); ball.y = clamp(ball.y + ball.vy * dt, .05, .95);
      if (Math.hypot(ball.x - target.x, ball.y - target.y) < .08) { my++; nt(); FX.sparkleAt(meIdx() === 0 ? W * .25 : W * .75, H * .5, 8); FX.Sound.pop(); }
      bc += dt; if (bc > .25) { bc = 0; net.send({ t: "tilt", s: my }); }
    },
    draw(ctx) {
      const bp = toCanvas(ball, meIdx()), tp = toCanvas(target, meIdx());
      ctx.save(); ctx.strokeStyle = "#7cff9d"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(tp.x, tp.y, 26, 0, 7); ctx.stroke(); ctx.fillStyle = "#ffd24b"; ctx.beginPath(); ctx.arc(bp.x, bp.y, 20, 0, 7); ctx.fill(); ctx.restore();
      scoreboard(ctx, [meIdx() === 0 ? my : their, meIdx() === 0 ? their : my], null, "Tilt Maze 📱");
      hint(ctx, host.sensors.on ? "tilt your phone to roll into the ring" : "press “enable” (phones), then tilt");
    },
  };
}


// 📳 SHAKE RACE — shake your phone the most in 5s
export function shakeMode() {
  let phase = "idle", t = 0, my = 0, their = 0, cool = 0;
  return {
    enter() { phase = "idle"; my = 0; their = 0; },
    action(a) { if (a === "enable") host.requestSensors(); else if (a === "go") { phase = "race"; t = 5; my = 0; net.send({ t: "shk-go" }); } },
    onNet(m) { if (m.t === "shk-go") { phase = "race"; t = 5; my = 0; } else if (m.t === "shk") their = m.s; },
    update(dt) { if (phase === "race") { t -= dt; cool -= dt; if ((host.sensors.shake || 0) > 28 && cool <= 0) { my++; cool = 0.18; FX.sparkleAt(meIdx() === 0 ? W * .25 : W * .75, H * .5, 6); net.send({ t: "shk", s: my }); } if (t <= 0) { phase = "done"; t = 3; } } else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; } },
    draw(ctx) { scoreboard(ctx, [meIdx() === 0 ? my : their, meIdx() === 0 ? their : my], phase === "race" ? t : null, "Shake Race 📳"); if (phase === "idle") big(ctx, "📳 Shake Race", "“enable” (phones) then “go” — shake fastest!"); else if (phase === "race") big(ctx, "SHAKE! 📳", "go go go"); else big(ctx, my > their ? "You win! 🎉" : my < their ? "Partner wins" : "tie!", ""); },
  };
}


// 🧍 POSE PARTY — strike the called-out body pose first (full-body pose)
export function poseMode() {
  const POSES = [["🙌 hands up", (lm) => lm[15].y < lm[11].y && lm[16].y < lm[12].y],
    ["🧍 T-pose", (lm) => Math.abs(lm[15].y - lm[11].y) < .13 && Math.abs(lm[16].y - lm[12].y) < .13 && Math.abs(lm[15].x - lm[16].x) > .4],
    ["🙆 touch your head", (lm) => Math.hypot(lm[15].x - lm[0].x, lm[15].y - lm[0].y) < .2 || Math.hypot(lm[16].x - lm[0].x, lm[16].y - lm[0].y) < .2],
    ["🤟 one hand up", (lm) => (lm[15].y < lm[0].y) !== (lm[16].y < lm[0].y)],
    ["🙏 hands together", (lm) => Math.hypot(lm[15].x - lm[16].x, lm[15].y - lm[16].y) < .12]];
  let pi = 0, score = [0, 0], winner = -1, claimed = false, t = 0;
  const bcast = () => net.send({ t: "pp", i: pi, s: score, w: winner });
  const nr = () => { pi = Math.floor(Math.random() * POSES.length); winner = -1; claimed = false; t = 12; bcast(); };
  const declare = (w) => { if (winner >= 0) return; winner = w; score[w]++; FX.confetti(w === 0 ? W / 4 : 3 * W / 4, H / 2, 22); FX.Sound.chime(); bcast(); };
  return {
    enter() { score = [0, 0]; host.pose.want = true; if (authority) nr(); },
    exit() { host.pose.want = false; },
    onNet(m) { if (m.t === "pp") { pi = m.i; score = m.s; winner = m.w; claimed = m.w >= 0; } else if (m.t === "pp-hit" && authority) declare(1); },
    update(dt) {
      const lm = host.pose.lm; if (winner < 0 && !claimed && lm.length >= 29) { try { if (POSES[pi][1](lm)) { claimed = true; if (authority) declare(0); else net.send({ t: "pp-hit" }); } } catch (_) {} }
      if (authority && winner < 0) { t -= dt; if (t <= 0) nr(); } else if (authority && winner >= 0) { t -= dt; if (t < -2) nr(); }
    },
    draw(ctx) { scoreboard(ctx, score, null, "Pose Party 🧍"); if (!host.pose.lm.length) big(ctx, "🧍 Pose Party", "loading body tracking… step back so you're in frame"); else big(ctx, "Strike: " + POSES[pi][0], winner < 0 ? "first to match wins!" : (winner === meIdx() ? "you nailed it! 🎉" : "partner got it")); },
  };
}


// 🕳️ HOLE IN THE WALL — pose your body to fit the hole (silhouette segmentation)
export function holeWallMode() {
  const SHAPES = [
    ["⬤ big circle", (x, y) => Math.hypot(x - .5, y - .45) < .34],
    ["▭ crouch low", (x, y) => y > .5 && Math.abs(x - .5) < .44],
    ["✝ arms out (T)", (x, y) => (Math.abs(y - .4) < .13 && Math.abs(x - .5) < .46) || (Math.abs(x - .5) < .16 && y > .3)],
    ["▯ stand tall", (x, y) => Math.abs(x - .5) < .17],
    ["◆ diamond", (x, y) => Math.abs(x - .5) + Math.abs(y - .45) < .42],
    ["◤ lean left", (x, y) => x > .06 && x < .5],
    ["◥ lean right", (x, y) => x > .5 && x < .94],
  ];
  let si = 0, phase = "idle", t = 0, my = 0, their = 0, lastFit = 0;
  const nr = () => { si = Math.floor(Math.random() * SHAPES.length); phase = "approach"; t = 5; };
  const fitPct = () => { const gw = host.seg.gw, gh = host.seg.gh, grid = host.seg.grid, fn = SHAPES[si][1]; let tot = 0, out = 0; for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) if (grid[gy * gw + gx]) { tot++; if (!fn((gx + .5) / gw, (gy + .5) / gh)) out++; } return tot < 10 ? 0 : 1 - out / tot; };
  return {
    enter() { host.seg.want = true; my = 0; their = 0; phase = "idle"; },
    exit() { host.seg.want = false; },
    action(a) { if (a === "go") nr(); },
    onNet(m) { if (m.t === "hw") their = m.s; },
    update(dt) {
      if (phase === "approach") { t -= dt; if (t <= 0) { lastFit = fitPct(); if (lastFit > 0.72) { my++; FX.flood(0, W, ["🎉", "✨", "💫"], 34); FX.Sound.chime(); } else FX.Sound.boo(); phase = "result"; t = 2.5; net.send({ t: "hw", s: my }); } }
      else if (phase === "result") { t -= dt; if (t <= 0) nr(); }
    },
    draw(ctx) {
      const S = meIdx(), gw = host.seg.gw, gh = host.seg.gh, fn = SHAPES[si][1];
      if (phase === "approach" || phase === "result") {
        ctx.save(); ctx.beginPath(); ctx.rect(S * MID, 0, MID, H); ctx.clip();
        ctx.fillStyle = phase === "result" ? (lastFit > 0.72 ? "rgba(20,80,40,.6)" : "rgba(90,20,30,.6)") : "rgba(20,12,40,.62)"; ctx.fillRect(S * MID, 0, MID, H);
        ctx.globalCompositeOperation = "destination-out";      // punch the hole → reveals the video behind
        const cw = MID / gw + 2, ch = H / gh + 2;
        for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) if (fn((gx + .5) / gw, (gy + .5) / gh)) { const p = toCanvas({ x: (gx + 0.5) / gw, y: (gy + 0.5) / gh }, S); ctx.fillRect(p.x - cw / 2, p.y - ch / 2, cw, ch); }
        ctx.restore();
      }
      scoreboard(ctx, [meIdx() === 0 ? my : their, meIdx() === 0 ? their : my], phase === "approach" ? t : null, "Hole in the Wall 🕳️");
      if (!host.seg.count && phase !== "idle") pill(ctx, "step back so your whole body shows…", W / 2, H * 0.5, 15);
      if (phase === "idle") big(ctx, "🕳️ Hole in the Wall", host.seg.count ? "press “go” — fit your body into the hole!" : "loading… step back so you're fully in frame");
      else if (phase === "approach") big(ctx, "Fit:  " + SHAPES[si][0], "strike the shape before the wall hits! " + Math.ceil(Math.max(0, t)));
      else big(ctx, lastFit > 0.72 ? "you fit! 🎉" : "squished 😅", Math.round(lastFit * 100) + "% inside the hole");
    },
  };
}


// 🐤 MOUTH FLAPPY — open your mouth to flap through gaps (face input)
export function flappyMode() {
  let bird = { y: .5, v: 0 }, pipes = [], sp = 0, score = 0, best = 0, their = 0, prevOpen = false;
  const reset = () => { bird = { y: .5, v: 0 }; pipes = []; sp = 0; score = 0; };
  return {
    enter() { reset(); best = 0; their = 0; },
    action(a) { if (a === "go") reset(); },
    onNet(m) { if (m.t === "flap") their = m.s; },
    update(dt, local) {
      const open = local && local.face && local.face.mouthOpen > 0.4;
      if (open && !prevOpen) bird.v = -0.62; prevOpen = open;
      bird.v += 1.7 * dt; bird.y += bird.v * dt;
      sp -= dt; if (sp <= 0) { sp = 1.6; pipes.push({ x: 1.1, gap: rnd(.28, .72), passed: false }); }
      for (const p of pipes) { p.x -= 0.45 * dt; if (!p.passed && p.x < .3) { p.passed = true; score++; best = Math.max(best, score); FX.Sound.pop(); net.send({ t: "flap", s: best }); } if (Math.abs(p.x - .3) < .08 && Math.abs(bird.y - p.gap) > .16) reset(); }
      pipes = pipes.filter((p) => p.x > -.15);
      if (bird.y < 0 || bird.y > 1) reset();
    },
    draw(ctx) {
      const S = meIdx(); ctx.save();
      for (const p of pipes) { const x = toCanvas({ x: p.x, y: 0 }, S).x, gy = p.gap * H; ctx.fillStyle = "rgba(90,200,120,.8)"; ctx.fillRect(x - 22, 0, 44, gy - 90); ctx.fillRect(x - 22, gy + 90, 44, H - gy - 90); }
      const bp = toCanvas({ x: .3, y: bird.y }, S); ctx.font = "40px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🐤", bp.x, bp.y); ctx.restore();
      scoreboard(ctx, [meIdx() === 0 ? best : their, meIdx() === 0 ? their : best], null, "Mouth Flappy 🐤");
      hint(ctx, "open your mouth to flap — don't hit the pipes!");
    },
  };
}


// 🎨 COLOR HUNT — show your camera something of the named color first
export function colorHuntMode() {
  const C = [["RED", 350, 15], ["ORANGE", 18, 45], ["YELLOW", 48, 68], ["GREEN", 80, 160], ["BLUE", 185, 250], ["PURPLE", 260, 300], ["PINK", 300, 345]];
  let ci = 0, score = [0, 0], winner = -1, claimed = false, t = 0;
  const inRange = (h, lo, hi) => lo > hi ? (h >= lo || h <= hi) : (h >= lo && h <= hi);
  const bcast = () => net.send({ t: "ch", i: ci, s: score, w: winner });
  const nr = () => { ci = Math.floor(Math.random() * C.length); winner = -1; claimed = false; t = 15; bcast(); };
  const declare = (w) => { if (winner >= 0) return; winner = w; score[w]++; FX.confetti(w === 0 ? W / 4 : 3 * W / 4, H / 2, 22); FX.Sound.chime(); bcast(); };
  return {
    enter() { score = [0, 0]; if (authority) nr(); },
    onNet(m) { if (m.t === "ch") { ci = m.i; score = m.s; winner = m.w; claimed = m.w >= 0; } else if (m.t === "ch-hit" && authority) declare(1); },
    update(dt) {
      if (winner < 0 && !claimed) { const h = host.videoHue(); if (h >= 0 && inRange(h, C[ci][1], C[ci][2])) { claimed = true; if (authority) declare(0); else net.send({ t: "ch-hit" }); } }
      if (authority && winner < 0) { t -= dt; if (t <= 0) nr(); } else if (authority && winner >= 0) { t -= dt; if (t < -2) nr(); }
    },
    draw(ctx) { scoreboard(ctx, score, null, "Color Hunt 🎨"); big(ctx, "Show me something " + C[ci][0], winner < 0 ? "hold it up to your camera!" : (winner === meIdx() ? "you found it! 🎨" : "partner found it")); },
  };
}


// 🎵 MATCH THE NOTE — hum to match the target pitch
export function noteMode() {
  const NOTES = [["A3", 220], ["C4", 262], ["E4", 330], ["G4", 392], ["A4", 440]];
  let ni = 0, hold = 0, score = 0, cents = 999;
  function playTone(f) { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(.2, a.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + .7); o.start(); o.stop(a.currentTime + .72); } catch (_) {} }
  const nr = () => { ni = Math.floor(Math.random() * NOTES.length); hold = 0; playTone(NOTES[ni][1]); };
  return {
    enter() { host.audio.want = true; score = 0; nr(); },
    exit() { host.audio.want = false; },
    action(a) { if (a === "go") nr(); },
    update(dt) { const p = host.audio.pitch, target = NOTES[ni][1]; if (p > 60 && p < 1200) { let d = p; while (d > target * 1.4) d /= 2; while (d < target * 0.7) d *= 2; cents = 1200 * Math.log2(d / target); if (Math.abs(cents) < 60) { hold += dt; if (hold > 1.4) { score++; FX.flood(0, W, ["🎵", "✨"], 20); FX.Sound.chime(); nr(); } } else hold = Math.max(0, hold - dt); } else { cents = 999; hold = Math.max(0, hold - dt); } },
    draw(ctx) {
      big(ctx, "🎵 Hum:  " + NOTES[ni][0], host.audio.level < 0.03 ? "hum into your mic…" : (Math.abs(cents) < 60 ? "hold it… 🎯" : (cents > 0 ? "a little lower ⬇️" : "a little higher ⬆️")));
      const bx = W / 2, by = H * 0.66, w = 300; ctx.save(); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(bx - w / 2, by, w, 12); const px = clamp(bx + (cents === 999 ? 0 : cents / 100 * w / 2), bx - w / 2, bx + w / 2); ctx.fillStyle = Math.abs(cents) < 60 ? "#7cff9d" : "#ffd24b"; ctx.fillRect(px - 5, by - 4, 10, 20); ctx.restore();
      pill(ctx, "matched: " + score + "  🎵", W / 2, 30, 15);
    },
  };
}


// 📣 SCREAM METER — loudest cheer in 5 seconds wins
export function screamMode() {
  let phase = "idle", t = 0, my = 0, their = 0;
  return {
    enter() { phase = "idle"; my = 0; their = 0; },
    action(a) { if (a === "go") { phase = "race"; t = 5; my = 0; net.send({ t: "scr-go" }); } },
    onNet(m) { if (m.t === "scr-go") { phase = "race"; t = 5; my = 0; } else if (m.t === "scr") their = m.s; },
    update(dt) { if (phase === "race") { t -= dt; my = Math.max(my, host.audio.level); net.send({ t: "scr", s: +my.toFixed(2) }); if (t <= 0) phase = "done"; } },
    draw(ctx) {
      scoreboard(ctx, [Math.round((meIdx() === 0 ? my : their) * 100), Math.round((meIdx() === 0 ? their : my) * 100)], phase === "race" ? t : null, "Scream Meter 📣");
      if (phase === "idle") big(ctx, "📣 Scream Meter", "press “go” then CHEER as loud as you can!");
      else if (phase === "race") { big(ctx, "SCREAM! 📣", "louder!!!"); ctx.fillStyle = "#ff5c8a"; ctx.fillRect(W / 2 - 150, H * 0.72, 300 * host.audio.level, 16); }
      else big(ctx, my > their ? "You're louder! 🏆" : my < their ? "Partner won 📣" : "tie!", "");
    },
  };
}


// ⌨️ TYPING RACE — first to type the phrase (keyboard)
export function typingMode() {
  const PH = ["i love you to the moon", "you are my favorite person", "cutest couple ever", "counting down the days", "wish you were here", "you make me smile", "best good morning texts", "come home soon please"];
  let phrase = "", typed = "", phase = "idle", winner = -1, score = [0, 0], onKey = null;
  const bcast = () => net.send({ t: "ty", p: phrase, w: winner, s: score, ph: phase });
  const nr = () => { phrase = pick(PH); typed = ""; winner = -1; phase = "go"; bcast(); };
  const declare = (w) => { if (winner >= 0) return; winner = w; score[w]++; FX.confetti(w === 0 ? W / 4 : 3 * W / 4, H / 2, 22); FX.Sound.chime(); bcast(); };
  return {
    enter() { score = [0, 0]; phase = "idle"; typed = ""; onKey = (e) => { if (phase !== "go") return; if (e.key === "Backspace") typed = typed.slice(0, -1); else if (e.key.length === 1) typed += e.key.toLowerCase(); if (typed === phrase) { if (authority) declare(0); else net.send({ t: "ty-done" }); } }; document.addEventListener("keydown", onKey); },
    exit() { if (onKey) document.removeEventListener("keydown", onKey); },
    action(a) { if (a === "go") { if (authority) nr(); else net.send({ t: "ty-start" }); } },
    onNet(m) { if (m.t === "ty") { phrase = m.p; winner = m.w; score = m.s; phase = m.ph; if (phase === "go") typed = ""; } else if (m.t === "ty-done" && authority) declare(1); else if (m.t === "ty-start" && authority) nr(); },
    draw(ctx) {
      scoreboard(ctx, score, null, "Typing Race ⌨️");
      if (phase === "idle") return big(ctx, "⌨️ Typing Race", "press “go”, then type the phrase fastest");
      if (winner >= 0) return big(ctx, winner === meIdx() ? "You won! ⌨️🎉" : "Partner won ⌨️", phrase);
      ctx.textAlign = "center"; ctx.fillStyle = "#fff"; outline(ctx, phrase, W / 2, H * 0.42, 28);
      const ok = phrase.startsWith(typed); ctx.font = "24px system-ui"; ctx.fillStyle = ok ? "#8dffb0" : "#ff8a8a"; ctx.textBaseline = "middle"; ctx.fillText(typed + "▌", W / 2, H * 0.54);
      hint(ctx, "just type — no need to click a box");
    },
  };
}


// 🎯 TAP ATTACK — tap the targets on your side (mouse/touch)
export function tapMode() {
  let dots = [], score = 0, their = 0, t = 0, sp = 0, lastTap = 0, phase = "idle";
  return {
    enter() { dots = []; score = 0; their = 0; phase = "idle"; },
    action(a) { if (a === "go") { phase = "race"; t = 20; score = 0; dots = []; } },
    onNet(m) { if (m.t === "tap") their = m.s; },
    update(dt) {
      if (phase !== "race") return; t -= dt; sp -= dt;
      if (sp <= 0) { sp = 0.8; dots.push({ x: rnd(.12, .88), y: rnd(.12, .88), life: 2.2 }); }
      for (const d of dots) d.life -= dt; dots = dots.filter((d) => d.life > 0);
      if (host.pointer.t > lastTap) { lastTap = host.pointer.t; const lo = meIdx() * MID, hi = lo + MID; if (host.pointer.x >= lo && host.pointer.x <= hi) { for (let i = dots.length - 1; i >= 0; i--) { const p = toCanvas(dots[i], meIdx()); if (Math.hypot(p.x - host.pointer.x, p.y - host.pointer.y) < 40) { dots.splice(i, 1); score++; FX.sparkleAt(host.pointer.x, host.pointer.y, 6); FX.Sound.pop(); net.send({ t: "tap", s: score }); break; } } } }
      if (t <= 0) phase = "done";
    },
    draw(ctx) {
      for (const d of dots) { const p = toCanvas(d, meIdx()); ctx.save(); ctx.globalAlpha = Math.min(1, d.life); ctx.fillStyle = "#ffd24b"; ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.stroke(); ctx.restore(); }
      scoreboard(ctx, [meIdx() === 0 ? score : their, meIdx() === 0 ? their : score], phase === "race" ? t : null, "Tap Attack 🎯");
      if (phase === "idle") big(ctx, "🎯 Tap Attack", "press “go” — tap the dots on your side!");
      else if (phase === "done") big(ctx, score > their ? "You win! 🎯" : score < their ? "Partner wins" : "tie!", "");
    },
  };
}

export const modes = {
  "sayit": { cat: "New senses 🎙️", ic: "🗣️", nm: "Say It First", how: ["A word appears — first to SAY it out loud wins", "Uses your mic (Chrome/Edge)"], actions: [["go", "🗣️ go"]], make: sayItMode },
  "decipher": { cat: "New senses 🎙️", ic: "🧩", nm: "Decipher", how: ["A riddle/scramble appears", "First to SAY the answer wins (mic)"], actions: [["go", "🧩 go"]], make: decipherMode },
  "treasure": { cat: "New senses 🎙️", ic: "🔍", nm: "Treasure Hunt", how: ["“Bring me a banana!” — grab the object & show your camera", "First to show it wins (object recognition)"], actions: [["go", "🔍 go"]], make: treasureMode },
  "distance": { cat: "New senses 🎙️", ic: "🌍", nm: "Distance", how: ["Both allow location", "See exactly how far apart you are 🥺 (only shared with each other)"], make: distanceMode },
  "tilt": { cat: "New senses 🎙️", ic: "📱", nm: "Tilt Maze", how: ["On phones: “enable”, then tilt to roll the ball", "Reach the ring — most in the round wins"], actions: [["enable", "📱 enable"]], make: tiltMode },
  "shake": { cat: "New senses 🎙️", ic: "📳", nm: "Shake Race", how: ["On phones: “enable”, then “go”", "Shake your phone the most in 5 seconds"], actions: [["enable", "📱 enable"], ["go", "📳 go"]], make: shakeMode },
  "poseparty": { cat: "New senses 🎙️", ic: "🧍", nm: "Pose Party", how: ["Stand back so your whole body is in frame", "First to strike the called-out pose wins (body tracking)"], make: poseMode },
  "holewall": { cat: "New senses 🎙️", ic: "🕳️", nm: "Hole in the Wall", how: ["Step back so your whole body shows", "A hole shape appears — pose so your silhouette fits before the wall hits!"], actions: [["go", "🕳️ go"]], make: holeWallMode },
  "flappy": { cat: "New senses 🎙️", ic: "🐤", nm: "Mouth Flappy", how: ["Open your mouth to flap the bird up", "Fly through the pipe gaps — highest score wins"], actions: [["go", "↻ restart"]], make: flappyMode },
  "colorhunt": { cat: "New senses 🎙️", ic: "🎨", nm: "Color Hunt", how: ["“Show me something RED!”", "Hold something that color to your camera — fastest wins"], actions: [["go", "🎨 go"]], make: colorHuntMode },
  "note": { cat: "New senses 🎙️", ic: "🎵", nm: "Match the Note", how: ["A note plays — hum it back", "Hold the right pitch to score (uses your mic)"], actions: [["go", "🎵 new note"]], make: noteMode },
  "scream": { cat: "New senses 🎙️", ic: "📣", nm: "Scream Meter", how: ["Press “go”, then cheer!", "Loudest in 5 seconds wins"], actions: [["go", "📣 go"]], make: screamMode },
  "typing": { cat: "New senses 🎙️", ic: "⌨️", nm: "Typing Race", how: ["A phrase appears — just start typing", "First to type it correctly wins"], actions: [["go", "⌨️ go"]], make: typingMode },
  "tapattack": { cat: "New senses 🎙️", ic: "🎯", nm: "Tap Attack", how: ["Tap the dots on your side (mouse/touch)", "Most taps in 20 seconds wins"], actions: [["go", "🎯 go"]], make: tapMode },
};
