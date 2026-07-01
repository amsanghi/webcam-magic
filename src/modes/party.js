// party.js — Party games (Games category): catch, pop, hockey, rps, don't-laugh, mirror, thumb war, sync test, photo booth, tic-tac-toe, connect four, memory, trivia, vault, charades.
import { FX, net, host, authority, meIdx, W, H, MID, toCanvas, rnd, pick, clamp, cursor, cursorPx, activeCur, roundRect, pill, outline, fit, hint, scoreboard, big } from "./_shared.js";


// ---------------- CATCH (falling hearts, catch with your hand) -----------
// Authority judges both players (each from their OWN self-detection), owns the
// items + score, and broadcasts them — so both screens show identical numbers.
export function catchMode() {
  let items = [], score = [0, 0], spawnT = 0, time = 30, bc = 0;
  const CH = ["❤️", "🍓", "🍰", "⭐", "🍩"];
  return {
    enter() { items = []; score = [0, 0]; time = 30; spawnT = 0; },
    onNet(m) { if (m.t === "catch") { items = m.i; score = m.s; time = m.tm; } },
    update(dt, local, remote) {
      if (!authority) return;                    // non-authority renders broadcast state only
      time -= dt; spawnT -= dt;
      if (spawnT <= 0 && time > 0) { spawnT = 0.55; items.push({ x: rnd(0.12, 0.88), y: -0.05, vy: rnd(0.28, 0.5), owner: Math.random() < 0.5 ? 0 : 1, ch: pick(CH) }); }
      const cur = [cursor(local), cursor(remote)];        // each in their own half-normalized space
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]; it.y += it.vy * dt;
        const c = cur[it.owner];
        if (c && Math.abs(c.x - it.x) < 0.1 && Math.abs(c.y - it.y) < 0.13) { score[it.owner]++; const p = toCanvas(it, it.owner); FX.sparkleAt(p.x, p.y, 6); FX.Sound.pop(); items.splice(i, 1); continue; }
        if (it.y > 1.1) items.splice(i, 1);
      }
      bc += dt; if (bc > 0.12) { bc = 0; net.send({ t: "catch", i: items.map((o) => ({ x: +o.x.toFixed(3), y: +o.y.toFixed(3), owner: o.owner, ch: o.ch })), s: score, tm: +time.toFixed(1) }); }
    },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const it of items) { const p = toCanvas(it, it.owner); ctx.font = "48px serif"; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.strokeText(it.ch, p.x, p.y); ctx.fillStyle = "#fff"; ctx.fillText(it.ch, p.x, p.y); }
      scoreboard(ctx, score, time, "Catch — most catches wins");
    },
  };
}


// ---------------- POP (bubbles rise, pop with a pointing finger) ---------
export function popMode() {
  let bubbles = [], score = [0, 0], spawnT = 0, bc = 0;
  return {
    enter() { bubbles = []; score = [0, 0]; },
    onNet(m) { if (m.t === "pop") { bubbles = m.b; score = m.s; } },
    update(dt, local, remote) {
      if (!authority) return;
      spawnT -= dt; if (spawnT <= 0) { spawnT = 0.5; bubbles.push({ x: rnd(0.12, 0.88), y: 1.1, vy: rnd(0.12, 0.26), r: rnd(0.05, 0.09), hue: rnd(0, 360) | 0, owner: Math.random() < 0.5 ? 0 : 1 }); }
      const tip = [cursor(local), cursor(remote)];
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]; b.y -= b.vy * dt;
        const c = tip[b.owner];
        if (c && Math.abs(c.x - b.x) < b.r + 0.03 && Math.abs(c.y - b.y) < b.r + 0.05) { score[b.owner]++; const p = toCanvas(b, b.owner); FX.burst(p.x, p.y, ["💧", "✨"], 6, 200); FX.Sound.pop(); bubbles.splice(i, 1); continue; }
        if (b.y < -0.1) bubbles.splice(i, 1);
      }
      bc += dt; if (bc > 0.12) { bc = 0; net.send({ t: "pop", b: bubbles.map((o) => ({ x: +o.x.toFixed(3), y: +o.y.toFixed(3), r: +o.r.toFixed(3), hue: o.hue, owner: o.owner })), s: score }); }
    },
    draw(ctx) {
      for (const b of bubbles) { const p = toCanvas(b, b.owner), r = b.r * MID; ctx.save(); ctx.fillStyle = `hsl(${b.hue},85%,60%)`; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.25, 0, 7); ctx.fill(); ctx.restore(); }
      scoreboard(ctx, score, null, "Pop — point to pop your bubbles");
    },
  };
}


// ---------------- HOCKEY (palm paddles, puck across the seam) ------------
export function hockeyMode() {
  let puck = { x: W / 2, y: H / 2, vx: 280, vy: 160 }, score = [0, 0];
  const reset = (dir) => { puck = { x: W / 2, y: H / 2, vx: 280 * dir, vy: rnd(-160, 160) }; };
  return {
    enter() { score = [0, 0]; reset(1); },
    onNet(m) { if (m.t === "puck" && !authority) puck = m.p; if (m.t === "hscore") score = m.s; },
    update(dt, local, remote) {
      const pads = [cursorPx(local, 0), cursorPx(remote, 1)];
      if (authority) {
        puck.x += puck.vx * dt; puck.y += puck.vy * dt;
        if (puck.y < 14 || puck.y > H - 14) { puck.vy *= -1; puck.y = clamp(puck.y, 14, H - 14); }
        for (const p of pads) { if (p && Math.hypot(p.x - puck.x, p.y - puck.y) < 56) { const a = Math.atan2(puck.y - p.y, puck.x - p.x); const sp = Math.hypot(puck.vx, puck.vy) + 40; puck.vx = Math.cos(a) * sp; puck.vy = Math.sin(a) * sp; FX.Sound.pop(); } }
        if (puck.x < 0) { score[1]++; FX.burst(40, puck.y, ["🥅"], 8); reset(1); net.send({ t: "hscore", s: score }); }
        if (puck.x > W) { score[0]++; FX.burst(W - 40, puck.y, ["🥅"], 8); reset(-1); net.send({ t: "hscore", s: score }); }
        net.send({ t: "puck", p: puck });
      }
    },
    draw(ctx) {
      ctx.save(); ctx.fillStyle = "#fff"; ctx.shadowColor = "#7cd2ff"; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(puck.x, puck.y, 14, 0, 7); ctx.fill(); ctx.restore();
      scoreboard(ctx, score, null, "Air Hockey — block with your palm");
    },
  };
}


// ---------------- ROCK PAPER SCISSORS ------------------------------------
export function rpsMode() {
  let phase = "idle", t = 0, mine = "", theirs = "", result = "";
  const read = (g) => { if (!g || !g.poses) return ""; if (g.poses.fist) return "rock"; if (g.poses.palm) return "paper"; if (g.poses.peace) return "scissors"; return ""; };
  const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
  function start() { phase = "count"; t = 3; result = ""; mine = theirs = ""; }
  return {
    action(a) { if (a === "start") { start(); net.send({ t: "rps-start" }); } },
    onNet(m) { if (m.t === "rps-start") start(); if (m.t === "rps-throw") theirs = m.pose; },
    update(dt, local) {
      if (phase === "count") { t -= dt; if (t <= 0) { phase = "shoot"; t = 1.2; mine = read(local) || "rock"; net.send({ t: "rps-throw", pose: mine }); } }
      else if (phase === "shoot") { t -= dt; if (t <= 0) { phase = "done"; t = 3; if (!theirs) theirs = "?"; result = mine === theirs ? "Tie!" : beats[mine] === theirs ? "You win! 🎉" : "Partner wins"; if (result.startsWith("You")) FX.confetti(W / 4, H / 2, 30); } }
      else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; }
    },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      if (phase === "idle") big(ctx, "Rock · Paper · Scissors", "press “go” — fist / palm / ✌️");
      else if (phase === "count") big(ctx, Math.ceil(t) + "", "get ready…");
      else if (phase === "shoot") big(ctx, "Shoot!", "");
      else { const e = { rock: "✊", paper: "✋", scissors: "✌️", "?": "❔" }; big(ctx, `${e[mine] || "?"}  vs  ${e[theirs] || "?"}`, result); }
    },
  };
}


// ---------------- DON'T LAUGH --------------------------------------------
export function dontLaughMode() {
  let loser = "";                       // "" | "p0" | "p1"
  return {
    enter() { loser = ""; },
    onNet(m) { if (m.t === "dl") loser = m.l; },
    update(dt, local, remote) {
      if (!authority || loser) return;
      const ll = local && local.face && (local.face.laugh || local.face.smile > 0.55);
      const rl = remote && remote.present && remote.face && (remote.face.laugh || remote.face.smile > 0.55);
      if (ll) loser = "p0"; else if (rl) loser = "p1";
      if (loser) { FX.addShake(0.4); net.send({ t: "dl", l: loser }); }
    },
    draw(ctx) {
      const mine = meIdx();
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      if (!loser) return big(ctx, "Don't Laugh 😐", "first to smile loses → 🤡");
      const youLost = loser === "p" + mine;
      big(ctx, youLost ? "You laughed! 😂" : "Partner laughed! 😂", "");
      ctx.save(); ctx.globalAlpha = 0.92; ctx.font = "200px serif"; ctx.textBaseline = "middle"; ctx.fillText("🤡", (loser === "p0" ? 0 : 1) * MID + MID / 2, H / 2); ctx.restore();
    },
  };
}


// ---------------- MIRROR ME ----------------------------------------------
export function mirrorMode() {
  const POSES = [["✊ fist", "fist"], ["✋ palm", "palm"], ["✌️ peace", "peace"], ["👍 thumbs up", "thumbsUp"], ["🤟 rock", "rockOn"], ["👉 point", "point"]];
  let ti = 0, t = 5, score = 0, bc = 0;
  const next = () => { ti = Math.floor(Math.random() * POSES.length); t = 5; };
  return {
    enter() { score = 0; next(); },
    onNet(m) { if (m.t === "mm") { ti = m.ti; t = m.tt; score = m.s; } },
    update(dt, local, remote) {
      if (!authority) return;
      t -= dt; const key = POSES[ti][1];
      const lh = local && local.poses && local.poses[key];
      const solo = !(remote && remote.present);
      const rh = solo ? lh : (remote.poses && remote.poses[key]);
      if (lh && rh) { score++; FX.sparkleAt(W / 2, H / 2, 12); FX.Sound.chime(); next(); }
      else if (t <= 0) next();
      bc += dt; if (bc > 0.1) { bc = 0; net.send({ t: "mm", ti, tt: t, s: score }); }
    },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "Both make: " + POSES[ti][0], `together: ${score} • ${Math.ceil(Math.max(0, t))}s`); },
  };
}


// ---------------- THUMB WAR ----------------------------------------------
export function thumbWarMode() {
  let bar = 0.5, winner = "", bc = 0;          // winner: "" | "p0" | "p1"
  return {
    enter() { bar = 0.5; winner = ""; },
    onNet(m) { if (m.t === "tw") { bar = m.b; winner = m.w; } },
    update(dt, local, remote) {
      if (!authority || winner) return;
      if (local && local.poses && local.poses.thumbsUp) bar += dt * 0.33;
      if (remote && remote.present && remote.poses && remote.poses.thumbsUp) bar -= dt * 0.33;
      bar = clamp(bar, 0, 1);
      if (bar >= 1) { winner = "p0"; FX.confetti(W / 2, H / 2, 30); FX.Sound.chime(); }
      else if (bar <= 0) { winner = "p1"; FX.confetti(W / 2, H / 2, 30); }
      bc += dt; if (bc > 0.08) { bc = 0; net.send({ t: "tw", b: bar, w: winner }); }
    },
    draw(ctx) {
      const mine = meIdx();
      ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(120, H / 2); ctx.lineTo(W - 120, H / 2); ctx.stroke();
      const x = 120 + bar * (W - 240);
      ctx.font = "74px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.strokeText("👍", x, H / 2 - 6); ctx.fillStyle = "#fff"; ctx.fillText("👍", x, H / 2 - 6);
      ctx.restore();
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      winner ? big(ctx, winner === "p" + mine ? "You pinned them! 👍🎉" : "Partner pinned you 👍", "") : big(ctx, "👍 Thumb War", "both hold 👍 — push the thumb to pin your partner!");
    },
  };
}


// ---------------- SYNC TEST (both throw a finger-count answer) -----------
export function syncTestMode() {
  const Q = ["How many kids one day? 🍼", "Pineapple on pizza? 🍍 (1=yes…5=no)", "Rate today 1-5 ⭐", "How much do you love me? ✋", "Beach🏖 1 … 5 mountains⛰", "Cats🐱 1 … 5 dogs🐶"];
  let phase = "idle", t = 0, qi = 0, mine = 0, theirs = 0, res = "", score = 0;
  const start = (i) => { qi = i; phase = "count"; t = 3; res = ""; };
  return {
    action(a) { if (a === "go" && phase !== "count") { const i = Math.floor(Math.random() * Q.length); start(i); net.send({ t: "st-go", q: i }); } },
    onNet(m) { if (m.t === "st-go") start(m.q); },
    update(dt, local, remote) {
      if (phase === "count") { t -= dt; if (t <= 0) { mine = local ? local.fingers : 0; theirs = remote ? remote.fingers : 0; res = mine === theirs ? "in sync! 💕" : "not quite 😜"; if (mine === theirs) { score++; FX.flood(0, W, ["💕", "✨"], 40); FX.Sound.chime(); } phase = "done"; t = 3.5; } }
      else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; }
    },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      if (phase === "idle") big(ctx, "💘 Sync Test", "press “go” — answer with your fingers • score " + score);
      else if (phase === "count") big(ctx, Q[qi], "throw your answer in… " + Math.ceil(t));
      else big(ctx, `you ${mine} · partner ${theirs}`, res);
    },
  };
}


// ---------------- PHOTO BOOTH (countdown -> framed keepsake) -------------
export function photoboothMode() {
  let phase = "idle", t = 0, snap = 0;
  const drawFrame = (ctx) => {
    ctx.save(); ctx.lineWidth = 14; ctx.strokeStyle = "#ff5c8a"; ctx.strokeRect(20, 20, W - 40, H - 40);
    ctx.font = "44px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ["💕", "💖", "💗", "💞"].forEach((e, i) => ctx.fillText(e, 60 + (i % 2) * (W - 120), 60 + (i > 1 ? H - 120 : 0)));
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(W / 2 - 150, H - 64, 300, 40);
    ctx.fillStyle = "#fff"; ctx.font = "bold 24px system-ui";
    ctx.fillText("♥ us · " + new Date().toISOString().slice(0, 10) + " ♥", W / 2, H - 44);
    ctx.restore();
  };
  return {
    action(a) { if (a === "shoot" && phase === "idle") { phase = "count"; t = 3; net.send({ t: "pb-shoot" }); } },
    onNet(m) { if (m.t === "pb-shoot" && phase === "idle") { phase = "count"; t = 3; } },
    update(dt) {
      if (phase === "count") { t -= dt; if (t <= 0) { phase = "snap"; snap = 2; } }
      else if (phase === "snap") { snap--; if (snap <= 0) { if (host && host.snapshot) host.snapshot("our-photobooth"); FX.flash(); phase = "idle"; } }
    },
    draw(ctx) { drawFrame(ctx); if (phase === "count") { ctx.fillStyle = "#fff"; ctx.textAlign = "center"; big(ctx, Math.ceil(t) + "", "smile! 😊"); } },
  };
}


// ---------------- TIC-TAC-TOE (point/pinch a cell, 2-player synced) ------
export function ticTacToeMode() {
  let board = Array(9).fill(""), turn = "X", winner = "", down = false;
  const myMark = () => authority ? "X" : "O";
  const GS = 330, gx = W / 2 - GS / 2, gy = H / 2 - GS / 2, cs = GS / 3;
  const cellAt = (px, py) => (px < gx || px > gx + GS || py < gy || py > gy + GS) ? -1 : Math.floor((py - gy) / cs) * 3 + Math.floor((px - gx) / cs);
  const win = () => { const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]; for (const [a, b, c] of L) if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a]; return board.every((x) => x) ? "draw" : ""; };
  return {
    enter() { board = Array(9).fill(""); turn = "X"; winner = ""; },
    action(a) { if (a === "reset") { board = Array(9).fill(""); turn = "X"; winner = ""; net.send({ t: "ttt-reset" }); } },
    onNet(m) { if (m.t === "ttt") { board[m.i] = m.mark; turn = m.mark === "X" ? "O" : "X"; winner = win(); } else if (m.t === "ttt-reset") { board = Array(9).fill(""); turn = "X"; winner = ""; } },
    update(dt, local) {
      const d = local && local.pinch && local.pinch.active;
      if (!winner && d && !down && turn === myMark()) {
        const c = toCanvas(local.pinch, 0), i = cellAt(c.x, c.y);
        if (i >= 0 && !board[i]) { board[i] = myMark(); net.send({ t: "ttt", i, mark: myMark() }); turn = myMark() === "X" ? "O" : "X"; winner = win(); if (winner) FX.confetti(W / 2, H / 2, 30); }
      }
      down = d;
    },
    draw(ctx) {
      ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 4;
      for (let k = 1; k < 3; k++) { ctx.beginPath(); ctx.moveTo(gx + k * cs, gy); ctx.lineTo(gx + k * cs, gy + GS); ctx.stroke(); ctx.beginPath(); ctx.moveTo(gx, gy + k * cs); ctx.lineTo(gx + GS, gy + k * cs); ctx.stroke(); }
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "72px system-ui";
      for (let i = 0; i < 9; i++) if (board[i]) { ctx.fillStyle = board[i] === "X" ? "#7cd2ff" : "#ff9aad"; ctx.fillText(board[i], gx + (i % 3) * cs + cs / 2, gy + Math.floor(i / 3) * cs + cs / 2); }
      ctx.restore();
      ctx.fillStyle = "#fff"; ctx.font = "20px system-ui"; ctx.textAlign = "center";
      ctx.fillText(winner ? (winner === "draw" ? "draw! — ↺ reset" : `${winner} wins! — ↺ reset`) : `you're ${myMark()} • ${turn === myMark() ? "your turn — pinch a cell" : "partner's turn"}`, W / 2, gy - 18);
    },
  };
}


// 🔴 CONNECT FOUR — drop by pointing to a column & pinching
export function connect4Mode() {
  const COLS = 7, ROWS = 6, cell = 66, gx = W / 2 - COLS * cell / 2, gy = H / 2 - ROWS * cell / 2 + 10;
  let board = [], turn = 0, winner = "", down = false, bc = 0;
  const empty = () => Array.from({ length: COLS * ROWS }, () => "");
  const at = (c, r) => board[r * COLS + c];
  const drop = (c, m) => { for (let r = ROWS - 1; r >= 0; r--) if (!at(c, r)) { board[r * COLS + c] = m; return r; } return -1; };
  const win = (c, r, m) => { for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) { let n = 1; for (const s of [1, -1]) { let x = c + dx * s, y = r + dy * s; while (x >= 0 && x < COLS && y >= 0 && y < ROWS && at(x, y) === m) { n++; x += dx * s; y += dy * s; } } if (n >= 4) return true; } return false; };
  const mark = () => turn === 0 ? "🔴" : "🟡";
  return {
    enter() { board = empty(); turn = 0; winner = ""; },
    action(a) { if (a === "reset") { board = empty(); turn = 0; winner = ""; net.send({ t: "c4", b: board, tn: turn, w: winner }); } },
    onNet(m) { if (m.t === "c4") { board = m.b; turn = m.tn; winner = m.w; } },
    update(dt, local, remote) {
      if (!authority) return;
      const cur = activeCur(local, remote, turn), d = cur && cur.down;
      if (!winner && d && !down && cur) { const c = Math.floor((cur.x - gx) / cell); if (c >= 0 && c < COLS) { const r = drop(c, mark()); if (r >= 0) { if (win(c, r, mark())) winner = mark(); else turn = turn ? 0 : 1; net.send({ t: "c4", b: board, tn: turn, w: winner }); FX.Sound.pop(); if (winner) FX.confetti(W / 2, H / 2, 30); } } }
      down = d;
      bc += dt; if (bc > .3) { bc = 0; net.send({ t: "c4", b: board, tn: turn, w: winner }); }
    },
    draw(ctx) {
      ctx.save(); ctx.fillStyle = "rgba(40,60,140,.55)"; roundRect(ctx, gx - 8, gy - 8, COLS * cell + 16, ROWS * cell + 16, 14); ctx.fill();
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const x = gx + c * cell + cell / 2, y = gy + r * cell + cell / 2; ctx.fillStyle = "#0b1022"; ctx.beginPath(); ctx.arc(x, y, cell * 0.4, 0, 7); ctx.fill(); const v = at(c, r); if (v) { ctx.font = `${cell * 0.7}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(v, x, y); } }
      ctx.restore();
      const mine = meIdx() === 0 ? "🔴" : "🟡";
      pill(ctx, winner ? `${winner} wins!  ↺ reset` : `you are ${mine} • ${turn === meIdx() ? "your turn — point & pinch a column" : "partner's turn"}`, W / 2, gy - 24, 15);
    },
  };
}


// 🧠 MEMORY MATCH — flip two, find the pairs (point & pinch)
export function memoryMode() {
  const EMO = ["🍕", "⭐", "🐱", "🌸", "🎈", "⚽", "🍩", "🎸"];
  const COLS = 4, ROWS = 4, cell = 118, gx = W / 2 - COLS * cell / 2, gy = H / 2 - ROWS * cell / 2 + 6;
  let cards = [], turn = 0, score = [0, 0], flips = [], lock = 0, down = false, bc = 0;
  const setup = () => { const d = [...EMO, ...EMO].sort(() => Math.random() - .5); cards = d.map((ch) => ({ ch, up: false, gone: false })); turn = 0; score = [0, 0]; flips = []; lock = 0; };
  return {
    enter() { setup(); },
    action(a) { if (a === "reset") { setup(); net.send({ t: "mem", c: cards, tn: turn, s: score }); } },
    onNet(m) { if (m.t === "mem") { cards = m.c; turn = m.tn; score = m.s; } },
    update(dt, local, remote) {
      if (!authority) return;
      if (lock > 0) { lock -= dt; if (lock <= 0 && flips.length === 2) { const [a, b] = flips; if (cards[a].ch !== cards[b].ch) { cards[a].up = cards[b].up = false; turn = turn ? 0 : 1; } flips = []; net.send({ t: "mem", c: cards, tn: turn, s: score }); } return; }
      const cur = activeCur(local, remote, turn), d = cur && cur.down;
      if (d && !down && cur && flips.length < 2) {
        const c = Math.floor((cur.x - gx) / cell), r = Math.floor((cur.y - gy) / cell);
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) { const i = r * COLS + c; if (!cards[i].up && !cards[i].gone) { cards[i].up = true; flips.push(i); FX.Sound.pop(); if (flips.length === 2) { const [a, b] = flips; if (cards[a].ch === cards[b].ch) { cards[a].gone = cards[b].gone = true; score[turn]++; flips = []; FX.sparkleAt(W / 2, H / 2, 8); } else lock = 1.1; } net.send({ t: "mem", c: cards, tn: turn, s: score }); } }
      }
      down = d;
      bc += dt; if (bc > .3) { bc = 0; net.send({ t: "mem", c: cards, tn: turn, s: score }); }
    },
    draw(ctx) {
      for (let i = 0; i < cards.length; i++) { const c = i % COLS, r = (i / COLS) | 0, x = gx + c * cell, y = gy + r * cell, card = cards[i]; ctx.save(); ctx.fillStyle = card.gone ? "rgba(120,255,170,.18)" : "rgba(30,36,58,.9)"; roundRect(ctx, x + 6, y + 6, cell - 12, cell - 12, 12); ctx.fill(); ctx.font = `${cell * 0.5}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.fillText(card.up || card.gone ? card.ch : "❓", x + cell / 2, y + cell / 2); ctx.restore(); }
      pill(ctx, `${score[meIdx()]} – ${score[meIdx() ^ 1]} • ${turn === meIdx() ? "your turn — flip two" : "partner's turn"}`, W / 2, gy - 22, 15);
    },
  };
}


// 🧩 TRIVIA — both answer with fingers (1/2/3)
export function triviaMode() {
  const Q = [{ q: "How many hearts does an octopus have?", o: ["1", "2", "3"], a: 2 }, { q: "Tallest animal?", o: ["Elephant", "Giraffe", "Horse"], a: 1 }, { q: "The Red Planet?", o: ["Venus", "Mars", "Jupiter"], a: 1 }, { q: "Strings on a guitar?", o: ["4", "6", "8"], a: 1 }, { q: "Largest ocean?", o: ["Atlantic", "Indian", "Pacific"], a: 2 }, { q: "Which is a fruit?", o: ["Tomato", "Carrot", "Onion"], a: 0 }, { q: "Fastest land animal?", o: ["Cheetah", "Lion", "Horse"], a: 0 }, { q: "Colors in a rainbow?", o: ["5", "6", "7"], a: 2 }, { q: "Freezing point of water °C?", o: ["0", "10", "32"], a: 0 }, { q: "How many continents?", o: ["5", "7", "9"], a: 1 }];
  let cur = null, phase = "idle", t = 0, score = [0, 0], mine = -1, theirs = -1;
  const start = (c) => { cur = c; phase = "count"; t = 5; mine = -1; theirs = -1; };
  const parseQ = (raw) => { try { const s = raw.indexOf("{"), e = raw.lastIndexOf("}"); const o = JSON.parse(raw.slice(s, e + 1)); if (o && o.q && Array.isArray(o.o) && o.o.length === 3 && o.a >= 0 && o.a <= 2) return { q: o.q, o: o.o.map(String), a: o.a }; } catch (_) {} return null; };
  return {
    action(a) { if (a === "go") { host.ai.ask({ system: "Write ONE fun general-knowledge trivia question as JSON ONLY: {\"q\":\"…\",\"o\":[\"A\",\"B\",\"C\"],\"a\":INDEX} where INDEX is 0, 1 or 2 for the correct option. Concise.", user: "one trivia question", max: 90, temp: 1.0 }, () => JSON.stringify(pick(Q))).then((raw) => { const c = parseQ(raw) || pick(Q); start(c); net.send({ t: "trv-go", c }); }); } },
    onNet(m) { if (m.t === "trv-go") start(m.c); else if (m.t === "trv") { phase = m.p; score = m.s; mine = m.mn ?? mine; theirs = m.th ?? theirs; } },
    update(dt, local, remote) {
      if (!authority || !cur) return;
      if (phase === "count") { t -= dt; if (t <= 0) { const fp = (g) => g && g.fingers ? Math.min(3, g.fingers) - 1 : -1; mine = fp(local); theirs = fp(remote); if (mine === cur.a) score[0]++; if (theirs === cur.a) score[1]++; phase = "reveal"; t = 4; net.send({ t: "trv", p: phase, s: score, mn: mine, th: theirs }); } }
      else if (phase === "reveal") { t -= dt; if (t <= 0) { phase = "idle"; net.send({ t: "trv", p: phase, s: score }); } }
    },
    draw(ctx) {
      scoreboard(ctx, score, null, "Trivia");
      if (phase === "idle" || !cur) return big(ctx, "🧩 Trivia", "press “go” — answer with 1, 2, or 3 fingers");
      ctx.textAlign = "center"; ctx.fillStyle = "#fff"; outline(ctx, cur.q, W / 2, H * 0.32, 26);
      cur.o.forEach((o, k) => { const hit = phase === "reveal" && k === cur.a; ctx.font = (hit ? "bold " : "") + "24px system-ui"; ctx.fillStyle = hit ? "#8dffb0" : "#fff"; ctx.textBaseline = "middle"; ctx.fillText(`${k + 1}.  ${o}${hit ? "  ✓" : ""}`, W / 2, H * 0.46 + k * 42); });
      if (phase === "count") pill(ctx, "answer in… " + Math.ceil(t), W / 2, H * 0.78, 16);
    },
  };
}


// 🔒 VAULT — co-op: each of you sees only HALF the code, combine to unlock
export function vaultMode() {
  let code = "", phase = "idle";
  const newCode = () => { code = String(Math.floor(1000 + Math.random() * 9000)); phase = "play"; };
  return {
    onNet(m) { if (m.t === "vault") { code = m.c; phase = "play"; } else if (m.t === "vault-win") phase = "win"; },
    async action(a) {
      if (a === "new") { newCode(); net.send({ t: "vault", c: code }); }
      else if (a === "enter") { if (phase !== "play") return; const v = await host.ask("Enter the full 4-digit code:"); if (v && v.trim() === code) { phase = "win"; net.send({ t: "vault-win" }); FX.flood(0, W, ["🎉", "💰", "✨"], 50); FX.Sound.chime(); } else if (v) { FX.Sound.boo(); FX.banner(W / 2, H * 0.3, "nope — try again 🔒"); } }
    },
    draw(ctx) {
      if (phase === "idle") return big(ctx, "🔒 The Vault", "co-op! press “new” to get a code");
      if (phase === "win") return big(ctx, "🔓 UNLOCKED!", "teamwork 💞");
      const half = meIdx() === 0 ? code.slice(0, 2) : code.slice(2, 4);
      big(ctx, "your digits:  " + half.split("").join(" "), "tell your partner, then one of you enters all 4");
    },
  };
}


// 🎭 CHARADES — one acts a prompt, the other guesses out loud
export function charadesMode() {
  const P = ["cat 🐱", "pizza 🍕", "swimming 🏊", "sleeping 😴", "playing guitar 🎸", "superhero 🦸", "dancing 💃", "fishing 🎣", "driving 🚗", "brushing teeth 🪥", "taking a selfie 🤳", "cooking 🍳", "crying 😭", "boxing 🥊", "an airplane ✈️", "a monkey 🐒", "a robot 🤖", "eating spaghetti 🍝"];
  let isActor = false, word = "", revealed = false;
  return {
    enter() { isActor = false; word = ""; revealed = false; },
    action(a) { if (a === "new") { isActor = true; revealed = false; word = pick(P); host.ai.ask({ system: "Give ONE fun thing to act out in charades — a person, action, movie, or animal. Just the answer, 1-4 words.", user: "one charades prompt", max: 12, temp: 1.1 }, () => pick(P)).then((w) => { word = (w || "").trim() || pick(P); }); net.send({ t: "char-role" }); } else if (a === "reveal") { revealed = true; net.send({ t: "char-rev", w: word }); } },
    onNet(m) { if (m.t === "char-role") { isActor = false; word = ""; revealed = false; } else if (m.t === "char-rev") { word = m.w; revealed = true; } },
    draw(ctx) { if (isActor && !revealed) big(ctx, "Act out: " + word, "no talking — use gestures & face!"); else if (revealed) big(ctx, "it was: " + word + " 🎉", ""); else big(ctx, "🎭 Charades", "your partner is acting — guess out loud!"); hint(ctx, "“new prompt” to be the actor • “reveal” the answer"); },
  };
}

export const modes = {
  "catch": { cat: "Games", ic: "🍓", nm: "Catch", how: ["Treats fall from the top", "Catch them with your hand — most catches wins"], make: catchMode },
  "pop": { cat: "Games", ic: "🫧", nm: "Pop", how: ["Bubbles float up", "Point your finger to pop them"], make: popMode },
  "hockey": { cat: "Games", ic: "🏒", nm: "Air Hockey", how: ["Your palm is the paddle", "Block the puck and knock it past your partner"], make: hockeyMode },
  "rps": { cat: "Games", ic: "✊", nm: "Rock Paper Scissors", how: ["Press “go” for a 3·2·1 countdown", "Throw ✊ fist / ✋ palm / ✌️ scissors"], actions: [["start", "go"]], make: rpsMode },
  "dontlaugh": { cat: "Games", ic: "😐", nm: "Don't Laugh", how: ["First one to smile or laugh loses…", "…and gets a clown filter 🤡"], make: dontLaughMode },
  "mirror": { cat: "Games", ic: "🪞", nm: "Mirror Me", how: ["Match the pose shown before time runs out", "Score as many as you can"], make: mirrorMode },
  "thumbwar": { cat: "Games", ic: "👍", nm: "Thumb War", how: ["Both hold a 👍", "Hold it to push the thumb to your partner's side & pin them"], make: thumbWarMode },
  "synctest": { cat: "Games", ic: "💘", nm: "Sync Test", how: ["A cute question appears", "Both answer with a finger count — match = in sync!"], actions: [["go", "go"]], make: syncTestMode },
  "photobooth": { cat: "Games", ic: "📸", nm: "Photo Booth", how: ["Press for a 3·2·1 countdown", "Strike a pose — it saves a framed photo to your Scrapbook"], actions: [["shoot", "📸 3·2·1"]], make: photoboothMode },
  "tictactoe": { cat: "Games", ic: "#️⃣", nm: "Tic-Tac-Toe", how: ["Take turns — pinch a cell to place your mark", "First three in a row wins"], actions: [["reset", "↺ reset"]], make: ticTacToeMode },
  "connect4": { cat: "Games", ic: "🔴", nm: "Connect Four", how: ["Take turns — point to a column & pinch to drop", "First to line up four wins"], actions: [["reset", "↺ reset"]], make: connect4Mode },
  "memory": { cat: "Games", ic: "🧠", nm: "Memory Match", how: ["Take turns flipping two cards (point & pinch)", "Find a pair to score and go again"], actions: [["reset", "↺ reset"]], make: memoryMode },
  "trivia": { cat: "Games", ic: "🧩", nm: "Trivia", how: ["A question with 3 options appears", "Both answer by holding up 1, 2, or 3 fingers"], actions: [["go", "🧩 go"]], make: triviaMode },
  "vault": { cat: "Games", ic: "🔒", nm: "The Vault", how: ["Co-op! Each of you sees only HALF the code", "Tell each other, then one of you enters all 4 digits"], actions: [["new", "🔒 new code"], ["enter", "🔢 enter"]], make: vaultMode },
  "charades": { cat: "Games", ic: "🎭", nm: "Charades", how: ["“new prompt” → act it out silently with gestures & face", "Partner guesses out loud • “reveal” the answer"], actions: [["new", "🎭 new prompt"], ["reveal", "👀 reveal"]], make: charadesMode },
};
