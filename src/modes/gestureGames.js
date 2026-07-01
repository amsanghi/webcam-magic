// gestureGames.js — Motion / timing games (Games category): target, simon, balloon, reaction, wink duel, freeze, rhythm, dance battle.
import { FX, net, host, authority, meIdx, W, H, MID, toCanvas, rnd, pick, clamp, cursor, cursorPx, activeCur, roundRect, pill, outline, fit, hint, scoreboard, big } from "./_shared.js";

// ================= GESTURE / VIDEO-DRIVEN GAMES =========================
// 🎯 TARGET TRACK — keep your fingertip on the moving ring (uses your hand + video position)
export function targetTrackMode() {
  let tgt = [{ x: .5, y: .5, vx: .22, vy: .16 }, { x: .5, y: .5, vx: -.18, vy: .2 }], score = [0, 0], bc = 0;
  return {
    enter() { score = [0, 0]; },
    onNet(m) { if (m.t === "trk") { tgt = m.g; score = m.s; } },
    update(dt, local, remote) {
      if (!authority) return;
      const cur = [cursor(local), cursor(remote)];
      for (let s = 0; s < 2; s++) { const t = tgt[s]; t.x += t.vx * dt; t.y += t.vy * dt; if (t.x < .1 || t.x > .9) t.vx *= -1; if (t.y < .12 || t.y > .9) t.vy *= -1; t.x = clamp(t.x, .1, .9); t.y = clamp(t.y, .12, .9); const c = cur[s]; if (c && Math.abs(c.x - t.x) < .09 && Math.abs(c.y - t.y) < .11) score[s]++; }
      bc += dt; if (bc > .08) { bc = 0; net.send({ t: "trk", g: tgt.map((t) => ({ x: +t.x.toFixed(3), y: +t.y.toFixed(3), vx: t.vx, vy: t.vy })), s: score }); }
    },
    draw(ctx) {
      for (let s = 0; s < 2; s++) { const p = toCanvas(tgt[s], s); ctx.save(); ctx.lineWidth = 6; ctx.strokeStyle = s === meIdx() ? "#7cff9d" : "#ff9a5c"; ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, 7); ctx.stroke(); ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fill(); ctx.restore(); }
      scoreboard(ctx, score, null, "Target — keep your finger on the ring");
    },
  };
}


// 🙈 SIMON SAYS — do the pose only when "Simon says" (pose detection + inhibition)
export function simonMode() {
  const P = [["✊", "fist"], ["✋", "palm"], ["✌️", "peace"], ["👍", "thumbsUp"], ["🤟", "rockOn"]];
  let pi = 0, simon = true, t = 0, score = [0, 0], judged = false, bc = 0;
  const next = () => { pi = Math.floor(Math.random() * P.length); simon = Math.random() < 0.65; t = 2.4; judged = false; };
  return {
    enter() { score = [0, 0]; next(); },
    onNet(m) { if (m.t === "ss") { pi = m.pi; simon = m.si; score = m.s; t = m.tt; } },
    update(dt, local, remote) {
      if (!authority) return;
      t -= dt;
      if (t <= 0 && !judged) { judged = true; const chk = (g, s) => { const did = g && g.poses && g.poses[P[pi][1]]; if ((simon && did) || (!simon && !did)) score[s]++; }; chk(local, 0); chk(remote, 1); FX.Sound.pop(); }
      if (t <= -0.8) next();
      bc += dt; if (bc > .12) { bc = 0; net.send({ t: "ss", pi, si: simon, s: score, tt: t }); }
    },
    draw(ctx) { scoreboard(ctx, score, null, "Simon Says"); big(ctx, (simon ? "Simon says: " : "just… ") + P[pi][0], simon ? "do it before time's up!" : "trick — do NOT do it 🙅"); },
  };
}


// 🎈 KEEPY-UP — bat the balloon up with your hand (palm tracking + physics on video)
export function balloonMode() {
  const fresh = () => [{ x: .5, y: .3, vy: 0 }, { x: .5, y: .3, vy: 0 }];
  let ball = fresh(), score = [0, 0], bc = 0;
  return {
    enter() { ball = fresh(); score = [0, 0]; },
    onNet(m) { if (m.t === "bal") { ball = m.b; score = m.s; } },
    update(dt, local, remote) {
      if (!authority) return;
      const cur = [cursor(local), cursor(remote)];
      for (let s = 0; s < 2; s++) { const b = ball[s]; b.vy += 0.55 * dt; b.y += b.vy * dt; const c = cur[s]; if (c && Math.abs(c.x - b.x) < .13 && Math.abs(c.y - b.y) < .13 && b.vy > -0.2) { b.vy = -0.62; b.x = clamp(b.x + (b.x - c.x) * 0.6, .05, .95); score[s]++; FX.Sound.pop(); } if (b.y > 1.06) { b.x = .5; b.y = .3; b.vy = 0; } b.y = clamp(b.y, 0, 1.06); }
      bc += dt; if (bc > .05) { bc = 0; net.send({ t: "bal", b: ball.map((b) => ({ x: +b.x.toFixed(3), y: +b.y.toFixed(3), vy: +b.vy.toFixed(3) })), s: score }); }
    },
    draw(ctx) { for (let s = 0; s < 2; s++) { const p = toCanvas(ball[s], s); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "54px serif"; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.strokeText("🎈", p.x, p.y); ctx.fillStyle = "#fff"; ctx.fillText("🎈", p.x, p.y); } scoreboard(ctx, score, null, "Keepy-Up — bat the balloon with your hand"); },
  };
}


// ⚡ REACTION DUEL — make a ✊ the instant it says GO (pose + reaction time, 2-player)
export function reactionMode() {
  let phase = "wait", t = 0, score = [0, 0], winner = -1, bc = 0;
  const arm = () => { phase = "wait"; t = rnd(1.5, 4.5); winner = -1; };
  return {
    enter() { score = [0, 0]; arm(); },
    onNet(m) { if (m.t === "rx") { phase = m.p; score = m.s; winner = m.w; } },
    update(dt, local, remote) {
      if (!authority) return;
      t -= dt;
      if (phase === "wait") { if (t <= 0) { phase = "go"; t = 3; } }
      else if (phase === "go" && winner < 0) { const lf = local && local.poses && local.poses.fist, rf = remote && remote.poses && remote.poses.fist; if (lf) { winner = 0; score[0]++; } else if (rf) { winner = 1; score[1]++; } if (winner >= 0) { phase = "done"; t = 2.5; FX.confetti(W / 2, H / 2, 26); FX.Sound.chime(); } else if (t <= 0) { phase = "done"; t = 2; } }
      else if (phase === "done" && t <= 0) arm();
      bc += dt; if (bc > .1) { bc = 0; net.send({ t: "rx", p: phase, s: score, w: winner }); }
    },
    draw(ctx) {
      scoreboard(ctx, score, null, "Reaction — ✊ the instant it says GO");
      if (phase === "wait") big(ctx, "wait…", "get your ✊ ready");
      else if (phase === "go") big(ctx, "GO! ✊", "make a fist NOW");
      else big(ctx, winner < 0 ? "nobody 😅" : (winner === meIdx() ? "You won! ⚡" : "Partner won ⚡"), "");
    },
  };
}


// 😉 WINK DUEL — first to wink on GO
export function winkBattleMode() {
  let phase = "wait", t = 0, score = [0, 0], winner = -1, bc = 0;
  const arm = () => { phase = "wait"; t = rnd(1.5, 4); winner = -1; };
  return {
    enter() { score = [0, 0]; arm(); },
    onNet(m) { if (m.t === "wk") { phase = m.p; score = m.s; winner = m.w; } },
    update(dt, local, remote) {
      if (!authority) return; t -= dt;
      if (phase === "wait" && t <= 0) { phase = "go"; t = 3; }
      else if (phase === "go" && winner < 0) { if (local && local.face && local.face.wink) { winner = 0; score[0]++; } else if (remote && remote.face && remote.face.wink) { winner = 1; score[1]++; } if (winner >= 0) { phase = "done"; t = 2.5; FX.confetti(W / 2, H / 2, 20); FX.Sound.chime(); } else if (t <= 0) { phase = "done"; t = 2; } }
      else if (phase === "done" && t <= 0) arm();
      bc += dt; if (bc > .1) { bc = 0; net.send({ t: "wk", p: phase, s: score, w: winner }); }
    },
    draw(ctx) { scoreboard(ctx, score, null, "Wink Duel"); if (phase === "wait") big(ctx, "wait…", "get ready to 😉"); else if (phase === "go") big(ctx, "WINK! 😉", "now!"); else big(ctx, winner < 0 ? "nobody 😅" : (winner === meIdx() ? "You winked first 😉" : "Partner won 😉"), ""); },
  };
}


// 🧊 FREEZE — hold perfectly still after FREEZE (uses hand motion)
export function freezeMode() {
  let phase = "idle", t = 0, score = [0, 0], out = { 0: false, 1: false }, bc = 0;
  return {
    enter() { score = [0, 0]; phase = "idle"; },
    action(a) { if (a === "start" && phase === "idle") { phase = "get"; t = 2; out = { 0: false, 1: false }; } },
    onNet(m) { if (m.t === "fz") { phase = m.p; score = m.s; t = m.tt; } },
    update(dt, local, remote) {
      if (!authority) return; if (phase !== "idle") t -= dt;
      if (phase === "get" && t <= 0) { phase = "freeze"; t = 4; }
      else if (phase === "freeze") { const chk = (g, s) => { if (!out[s] && g && g.handSpeed > 0.045) out[s] = true; }; chk(local, 0); chk(remote, 1); if (t <= 0) { for (let s = 0; s < 2; s++) if (!out[s]) score[s]++; phase = "done"; t = 2.5; } }
      else if (phase === "done" && t <= 0) phase = "idle";
      bc += dt; if (bc > .1) { bc = 0; net.send({ t: "fz", p: phase, s: score, tt: t }); }
    },
    draw(ctx) {
      scoreboard(ctx, score, phase === "freeze" ? t : null, "Freeze — hold still");
      if (phase === "idle") big(ctx, "🧊 Freeze", "press start, then DON'T move");
      else if (phase === "get") big(ctx, "get ready… " + Math.ceil(Math.max(0, t)), "");
      else if (phase === "freeze") { big(ctx, "FREEZE! 🧊", "don't move a muscle"); for (let s = 0; s < 2; s++) if (out[s]) { ctx.save(); ctx.font = "80px serif"; ctx.textAlign = "center"; ctx.fillText("❌", s * MID + MID / 2, H * 0.72); ctx.restore(); } }
      else big(ctx, "⏱ time!", "still-standers score a point");
    },
  };
}


// 🥁 RHYTHM — clap on the beat (uses clap detection)
export function rhythmMode() {
  let since = 0, score = [0, 0], hit = { 0: false, 1: false }, prev = { 0: false, 1: false }, bc = 0;
  const period = 1.0;
  return {
    enter() { score = [0, 0]; since = 0; },
    onNet(m) { if (m.t === "ry") { score = m.s; since = m.sc; } },
    update(dt, local, remote) {
      if (!authority) return; since += dt; const ph = since % period;
      if (ph < 0.03) hit = { 0: false, 1: false };
      const inWin = ph < 0.28;
      [[local, 0], [remote, 1]].forEach(([g, s]) => { const c = g && g.two && g.two.clap; if (c && !prev[s]) { if (inWin && !hit[s]) { score[s]++; hit[s] = true; FX.sparkleAt(s === 0 ? W * .25 : W * .75, H * .5, 8); FX.Sound.pop(); } } prev[s] = c; });
      bc += dt; if (bc > .1) { bc = 0; net.send({ t: "ry", s: score, sc: +since.toFixed(2) }); }
    },
    draw(ctx) { const ph = since % period, pulse = ph < 0.28; ctx.save(); ctx.translate(W / 2, H / 2); ctx.fillStyle = pulse ? "rgba(124,255,157,.5)" : "rgba(255,255,255,.14)"; ctx.beginPath(); ctx.arc(0, 0, pulse ? 92 : 60, 0, 7); ctx.fill(); ctx.restore(); scoreboard(ctx, score, null, "Rhythm — 👏 clap when the circle pulses"); },
  };
}


// ---------------- DANCE BATTLE (pose-match scoring) ----------------------
export function danceBattleMode() {
  const MOVES = [["✊ fist", "fist"], ["✋ palm", "palm"], ["✌️ peace", "peace"], ["🤟 rock", "rockOn"], ["👍 up", "thumbsUp"], ["👉 point", "point"], ["🤙 pinky", "pinky"]];
  let ti = 0, t = 0, score = [0, 0], hit = { 0: false, 1: false }, bc = 0;
  const next = () => { ti = Math.floor(Math.random() * MOVES.length); t = 2.2; hit = { 0: false, 1: false }; };
  return {
    enter() { score = [0, 0]; next(); },
    onNet(m) { if (m.t === "db") { score = m.s; ti = m.ti; t = m.tt; } },
    update(dt, local, remote) {
      if (!authority) return;
      t -= dt; const key = MOVES[ti][1];
      const check = (g, s) => { if (!hit[s] && g && g.poses && g.poses[key]) { hit[s] = true; score[s]++; FX.sparkleAt(s === 0 ? W * 0.25 : W * 0.75, H * 0.5, 8); FX.Sound.pop(); } };
      check(local, 0); check(remote, 1);
      if (t <= 0) next();
      bc += dt; if (bc > 0.1) { bc = 0; net.send({ t: "db", s: score, ti, tt: t }); }
    },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "bold 30px system-ui"; ctx.fillText(score[0] + "", W * 0.25, 56); ctx.fillText(score[1] + "", W * 0.75, 56); big(ctx, "do: " + MOVES[ti][0], "match the move in time! • " + Math.ceil(Math.max(0, t))); },
  };
}

export const modes = {
  "target": { cat: "Games", ic: "🎯", nm: "Target Track", how: ["A ring drifts around your side", "Keep your fingertip on it — most seconds-on-target wins"], make: targetTrackMode },
  "simon": { cat: "Games", ic: "🙈", nm: "Simon Says", how: ["Do the pose ONLY when it says “Simon says”", "Do it on a trick round and you miss the point"], make: simonMode },
  "balloon": { cat: "Games", ic: "🎈", nm: "Keepy-Up", how: ["A balloon falls on your side", "Bat it up with your hand — most hits before it drops wins"], make: balloonMode },
  "reaction": { cat: "Games", ic: "⚡", nm: "Reaction Duel", how: ["Wait for it…", "Make a ✊ the instant it says GO — fastest wins the round"], make: reactionMode },
  "winkbattle": { cat: "Games", ic: "😉", nm: "Wink Duel", how: ["Wait for GO, then 😉 wink", "First to wink wins the round"], make: winkBattleMode },
  "freeze": { cat: "Games", ic: "🧊", nm: "Freeze", how: ["On FREEZE, hold perfectly still", "Move your hands and you're out — last still wins"], actions: [["start", "🧊 start"]], make: freezeMode },
  "rhythm": { cat: "Games", ic: "🥁", nm: "Rhythm", how: ["A circle pulses to a beat", "👏 clap in time — score for on-beat claps"], make: rhythmMode },
  "dancebattle": { cat: "Games", ic: "🕺", nm: "Dance Battle", how: ["A move is called out each round", "Match it in time — score vs your partner"], make: danceBattleMode },
};
