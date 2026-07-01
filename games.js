// games.js — stateful MODES: physics toys, draw, stamp, and mini-games.
// Free-play passive effects live in app.js. Each mode is a small object with
// enter/exit/update(dt,local,remote)/draw(ctx)/onNet(msg)/action(a).
// `net.send(obj)` broadcasts to the partner; app routes non-gesture msgs to onNet.

import * as FX from "./effects.js";
import { createShareMode } from "./share.js";
const { W, H, MID, toCanvas, rnd, pick } = FX;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// best "cursor" for a side's hand: pinch > point > palm
function cursor(g) {
  if (!g) return null;
  if (g.pinch && g.pinch.active) return { x: g.pinch.x, y: g.pinch.y, down: true };
  if (g.point && g.point.active) return { x: g.point.x, y: g.point.y, down: false };
  if (g.palm) return { x: g.palm.x, y: g.palm.y, down: false };
  return null;
}

export function createGames(net, host) {
  let M = null, modeName = "free", authority = true;
  const adult = true;                   // flirty deck always on
  const setAuthority = (b) => { authority = b; };
  const meIdx = () => authority ? 0 : 1;   // this client's player index (authority = player 0)
  const setAdult = () => {};             // kept for API compat (no-op)

  // ---------------- TOYS (physics + grab + throw + gravity + magnet) -------
  function toysMode() {
    const TOY = ["🧸", "🎈", "⚽", "📷", "🍕", "🪀", "🍩"];
    let objs = [], gravity = true, grabbed = { 0: null, 1: null };
    let prevSpread = null, prevTwist = null, prevShake = { 0: false, 1: false };
    const spawn = () => objs.push({ x: rnd(W * 0.2, W * 0.8), y: rnd(80, 240), vx: 0, vy: 0, s: rnd(46, 72), rot: 0, ch: pick(TOY), stick: null });
    const angDelta = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    return {
      enter() { objs = []; for (let i = 0; i < 5; i++) spawn(); },
      action(a) { if (a === "gravity") gravity = !gravity; if (a === "spawn") spawn(); if (a === "clear") objs = []; },
      update(dt, local, remote) {
        const hands = [{ g: local, side: 0 }, { g: remote, side: 1 }];
        for (const { g, side } of hands) {
          if (!g) continue;
          const c = cursor(g); const isPinch = g.pinch && g.pinch.active;
          const cp = c ? toCanvas(c, side) : null;
          // grab nearest on pinch
          if (isPinch && cp) {
            if (grabbed[side] == null) {
              let best = -1, bd = 90;
              objs.forEach((o, i) => { const d = Math.hypot(o.x - cp.x, o.y - cp.y); if (d < bd) { bd = d; best = i; } });
              if (best >= 0) grabbed[side] = best;
            }
            if (grabbed[side] != null && objs[grabbed[side]]) {
              const o = objs[grabbed[side]];
              o.vx = (cp.x - o.x) * 12; o.vy = (cp.y - o.y) * 12; o.stick = null;
            }
          } else grabbed[side] = null;
          // magnet: open palm attracts toys
          if (g.poses && g.poses.palm && cp) {
            for (const o of objs) { const dx = cp.x - o.x, dy = cp.y - o.y, d = Math.hypot(dx, dy) || 1; if (d < 320) { o.vx += (dx / d) * 900 * dt; o.vy += (dy / d) * 900 * dt; } }
          }
          // stick a toy to the face if dropped near the nose
          if (g.face && g.face.nose) {
            const np = toCanvas(g.face.nose, side);
            for (const o of objs) if (!o.stick && grabbed[side] == null && Math.hypot(o.x - np.x, o.y - np.y) < 46 && Math.abs(o.vx) + Math.abs(o.vy) < 60) o.stick = side;
          }
          // head-shake scatters everything (rising edge)
          if (g.face && g.face.headShake && !prevShake[side]) for (const o of objs) { o.vx += rnd(-450, 450); o.vy += rnd(-560, -120); o.stick = null; }
          prevShake[side] = g.face && g.face.headShake;
        }
        // two-hand spread -> scale, twist -> rotate the grabbed toy
        const gi = grabbed[0] != null ? grabbed[0] : grabbed[1];
        const th = local && local.two && local.two.spread.active && gi != null && objs[gi];
        if (th) {
          const o = objs[gi];
          if (prevSpread != null) o.s = clamp(o.s * (1 + (local.two.spread.dist - prevSpread) * 2.2), 24, 220);
          if (prevTwist != null) o.rot += angDelta(local.two.twist.angle, prevTwist);
          prevSpread = local.two.spread.dist; prevTwist = local.two.twist.angle;
        } else { prevSpread = prevTwist = null; }
        // integrate
        for (let i = 0; i < objs.length; i++) {
          const o = objs[i];
          const heldBy = (grabbed[0] === i || grabbed[1] === i);
          if (o.stick != null && !heldBy) {            // follow that side's nose
            const g = o.stick === 0 ? local : remote;
            if (g && g.face && g.face.nose) { const np = toCanvas(g.face.nose, o.stick); o.x = np.x; o.y = np.y - 30; o.vx = o.vy = 0; continue; }
          }
          if (!heldBy) {
            if (gravity) o.vy += 1400 * dt;
            o.vx *= 0.99; o.vy *= 0.99;
            o.x += o.vx * dt; o.y += o.vy * dt;
            if (o.y > H - o.s / 2) { o.y = H - o.s / 2; o.vy *= -0.55; o.vx *= 0.8; }
            if (o.y < o.s / 2) { o.y = o.s / 2; o.vy *= -0.5; }
            if (o.x < o.s / 2) { o.x = o.s / 2; o.vx *= -0.6; }
            if (o.x > W - o.s / 2) { o.x = W - o.s / 2; o.vx *= -0.6; }
          }
        }
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (const o of objs) { ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0); ctx.font = `${o.s}px serif`; ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 10; ctx.fillText(o.ch, 0, 0); ctx.restore(); }
        hint(ctx, "Toys — pinch grab/throw • two hands: spread=resize, twist=rotate • palm=magnet • shake head to scatter • drop on nose to wear");
      },
    };
  }

  // ---------------- DRAW (pinch to draw, synced) + co-op template ----------
  function drawMode() {
    const strokes = []; let cur = { 0: null, 1: null };
    const COLOR = { 0: "#7cd2ff", 1: "#ff9aad" };
    function addPt(side, pt, color) {
      let c = cur[side];
      if (!c) { c = { side, color, pts: [] }; strokes.push(c); cur[side] = c; }
      c.pts.push(pt);
    }
    return {
      enter() { strokes.length = 0; cur = { 0: null, 1: null }; },
      action(a) { if (a === "clear") { strokes.length = 0; net.send({ t: "draw-clear" }); } },
      onNet(m) { if (m.t === "draw-clear") strokes.length = 0; else if (m.t === "draw") addPt(1, { x: m.x, y: m.y }, m.color || "#ff9aad"); else if (m.t === "draw-up") cur[1] = null; },
      update(dt, local) {
        if (local && local.pinch && local.pinch.active) {
          const pt = { x: local.pinch.x, y: local.pinch.y };
          addPt(0, pt, COLOR[0]); net.send({ t: "draw", x: pt.x, y: pt.y, color: COLOR[0] });
        } else if (cur[0]) { cur[0] = null; net.send({ t: "draw-up" }); }
      },
      draw(ctx) {
        // faint co-op heart template
        ctx.save(); ctx.globalAlpha = 0.12; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
        ctx.beginPath(); const cx = W / 2, cy = H / 2 + 40, s = 150;
        for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.1) {
          const x = cx + s * 16 * Math.pow(Math.sin(a), 3) / 16;
          const y = cy - s * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16;
          a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.restore();
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const st of strokes) {
          if (st.pts.length < 2) continue;
          ctx.strokeStyle = st.color; ctx.lineWidth = 8; ctx.beginPath();
          st.pts.forEach((p, i) => { const c = toCanvas(p, st.side); i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y); });
          ctx.stroke();
        }
        hint(ctx, "Draw — pinch to paint together • clear with the ✕ button");
      },
    };
  }

  // ---------------- STAMP (pinch-down drops a sticker, synced) -------------
  function stampMode() {
    const SET = ["⭐", "💖", "🌸", "🔥", "😎", "🦄", "🍀", "👑"], stamps = [];
    let idx = 0, downPrev = { 0: false, 1: false };
    return {
      enter() { stamps.length = 0; },
      action(a) { if (a === "next") idx = (idx + 1) % SET.length; if (a === "clear") stamps.length = 0; },
      onNet(m) { if (m.t === "stamp") stamps.push({ side: 1, x: m.x, y: m.y, ch: m.ch }); },
      update(dt, local) {
        const down = local && local.pinch && local.pinch.active;
        if (down && !downPrev[0]) { const p = { x: local.pinch.x, y: local.pinch.y }; stamps.push({ side: 0, x: p.x, y: p.y, ch: SET[idx] }); net.send({ t: "stamp", x: p.x, y: p.y, ch: SET[idx] }); }
        downPrev[0] = down;
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (const s of stamps) { const c = toCanvas(s, s.side); ctx.font = "54px serif"; ctx.fillText(s.ch, c.x, c.y); }
        hint(ctx, `Stamp — pinch to place ${SET[idx]} • “next” button cycles the sticker`);
      },
    };
  }

  // ---------------- CATCH (falling hearts, catch with your hand) -----------
  // Authority judges both players (each from their OWN self-detection), owns the
  // items + score, and broadcasts them — so both screens show identical numbers.
  function catchMode() {
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
  function popMode() {
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
  function hockeyMode() {
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
  function rpsMode() {
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
  function dontLaughMode() {
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
  function mirrorMode() {
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

  // ---------------- PHOTO BOOTH (countdown -> framed keepsake) -------------
  function photoboothMode() {
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

  // ---------------- SYNC TEST (both throw a finger-count answer) -----------
  function syncTestMode() {
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

  // ---------------- THUMB WAR ----------------------------------------------
  function thumbWarMode() {
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

  // ---------------- DATE SPINNER -------------------------------------------
  function spinnerMode() {
    const IDEAS = ["cook together 🍳", "stargaze 🌌", "play 20 questions ❓", "watch a movie 🎬", "dance 💃", "order the same food 🍜", "draw each other ✏️", "plan a trip ✈️", "karaoke 🎤", "truth or dare 😈", "make a playlist 🎧", "bake something 🧁"];
    let phase = "idle", t = 0, idx = 0, shown = "spin for a date idea";
    const start = (i) => { idx = i; phase = "spin"; t = 1.6; };
    return {
      action(a) { if (a === "spin" && phase !== "spin") { const i = Math.floor(Math.random() * IDEAS.length); start(i); net.send({ t: "spin", idx: i }); } },
      onNet(m) { if (m.t === "spin") start(m.idx); },
      update(dt) { if (phase === "spin") { t -= dt; if (t <= 0) { shown = IDEAS[idx]; phase = "done"; FX.flood(0, W, ["🎉", "💕"], 30); FX.Sound.chime(); } else if (t > 0.2) shown = IDEAS[Math.floor(Math.random() * IDEAS.length)]; } },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "🎡 " + shown, phase === "done" ? "go do it! 💞" : "press spin"); },
    };
  }

  // ---------------- DRESS-UP (matching hats -> twinning) -------------------
  function dressUpMode() {
    const HATS = ["🎩", "👑", "🧢", "🎓", "👒", "🪖", "🎀", "😎", "🤠", "👓", "🍄", "🐱"];
    let mine = -1, theirs = -1, twin = false, lastLocal = null, lastRemote = null;
    const drawHat = (ctx, g, side, idx) => {
      if (!g || !g.face || !g.face.nose || idx < 0) return;
      const n = toCanvas(g.face.nose, side), gl = HATS[idx] === "😎" || HATS[idx] === "👓";
      ctx.save(); ctx.font = "84px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(HATS[idx], n.x, n.y + (gl ? -18 : -150)); ctx.restore();
    };
    return {
      enter() { mine = theirs = -1; twin = false; },
      action(a) { if (a === "next") { mine = (mine + 1) % HATS.length; net.send({ t: "hat", i: mine }); } if (a === "off") { mine = -1; net.send({ t: "hat", i: -1 }); } },
      onNet(m) { if (m.t === "hat") theirs = m.i; },
      update(dt, local, remote) { lastLocal = local; lastRemote = remote; if (mine >= 0 && mine === theirs) { if (!twin) { twin = true; FX.confetti(W / 2, H / 2, 40); FX.banner(W / 2, H * 0.3, "twinning! 👯"); FX.Sound.chime(); } } else twin = false; },
      draw(ctx) { drawHat(ctx, lastLocal, 0, mine); drawHat(ctx, lastRemote, 1, theirs); hint(ctx, "Dress-Up — “next hat” to cycle • match your partner's hat to twin 👯"); },
    };
  }

  // ---------------- SLOW DANCE (romantic ambient + beat hearts) ------------
  function slowDanceMode() {
    let acc = 0;
    return {
      exit() { FX.setTint(255, 150, 180, 0); FX.setVignette(0, false); FX.setVignette(1, false); },
      update(dt) {
        FX.setTint(255, 150, 180, 0.18); FX.setVignette(0, true); FX.setVignette(1, true);
        const beat = FX.getBeat(); acc += dt * (2 + beat * 12);
        if (acc > 1) { acc = 0; FX.emoji(rnd(0, W), H + 20, rnd(-20, 20), -rnd(40, 95) * (1 + beat), pick(["💗", "💖", "💕", "🤍", "🌹"]), rnd(24, 44) * (1 + beat * 0.5), rnd(3, 5), -28, { vr: 0 }); }
      },
      draw(ctx) { ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = "#fff"; ctx.font = "20px system-ui"; ctx.textAlign = "center"; ctx.fillText("💃  slow dance  🕺  — play some music and sway together", W / 2, H - 26); ctx.restore(); },
    };
  }

  // ---------------- TRUTH OR DARE ------------------------------------------
  function truthDareMode() {
    const TRUTH = ["What did you first notice about me? 😏", "Favorite memory of us? 💭", "Most embarrassing crush? 🙈", "What do you miss most right now? 🥺", "One thing you've never told me? 🤫", "Describe me in 3 words 💬", "Dream date? ✨", "Who said 'I love you' in your head first? 💘"];
    const DARE = ["Send a flying kiss 😘", "Best dance move, go 💃", "Silliest face 🤪", "Sing 5 seconds of a song 🎤", "Show your last photo 📷", "3 air high-fives 🙌", "Wink at the camera 😉", "Say 'I love you' in a funny voice 💕"];
    // flirtier deck unlocked by the 18+ toggle (suggestive, not explicit)
    const TRUTH_A = ["Where do you most want to be kissed? 😏", "What outfit of mine drives you crazy? 👀", "Describe your ideal cuddle… in detail 🫠", "What's the first thing you'd do if I walked in right now? 😉", "Rate our last kiss 1–10 😘", "Big spoon or little spoon — and why? 😌", "What's something you've been wanting to try with me? 😏", "Where's the first place you'd kiss me? 💋", "What were you thinking last time you looked at me like that? 👀", "What's your favorite thing about how I look right now? 🔥", "Lights on or off? 🌙😏", "What outfit do you secretly want to peel me out of… of the ones you've seen? 👀"];
    const DARE_A = ["Blow a slow kiss 😘", "Bite your lip at the camera 😏", "Whisper something only I'd want to hear 🤫", "Give the camera your most kissable face 💋", "Slow wink + a 'come here' finger 😉", "Trace a slow heart on your lips 💋", "Do your most charming 'miss you' eyes 🥺😏", "Send a 3-second slow-motion kiss 💋", "Give a flirty over-the-shoulder look 😏", "Show me where you'd want my hand right now (keep it classy 😏)", "Undo one button / push up a sleeve 😉", "Strike your most confident pose 🔥"];
    let text = "press truth or dare", kind = "";
    return {
      action(a) { if (a === "truth") { kind = "truth"; text = pick(adult ? TRUTH_A : TRUTH); net.send({ t: "td", kind, text }); } if (a === "dare") { kind = "dare"; text = pick(adult ? DARE_A : DARE); net.send({ t: "td", kind, text }); FX.flood(0, W, ["🔥"], 14); } },
      onNet(m) { if (m.t === "td") { kind = m.kind; text = m.text; FX.flood(0, W, kind === "dare" ? ["🔥"] : ["💬"], 14); } },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, kind === "dare" ? "🔥 DARE" : kind === "truth" ? "💬 TRUTH" : "😈 Truth or Dare", text); },
    };
  }

  // ---------------- MAGIC 8-BALL (shake your head to ask) ------------------
  function eightBallMode() {
    const A = ["yes 💯", "no 🙅", "definitely 😍", "ask again later 😴", "100% 💖", "never 😂", "maybe 🤔", "absolutely 🔥", "in your dreams 😜", "of course, my love 💕", "the stars say yes ✨", "nope 🙃"];
    let ans = "", t = 0, prev = false;
    return {
      enter() { ans = ""; },
      onNet(m) { if (m.t === "8ball") { ans = m.a; t = 4; FX.Sound.boing(); } },
      update(dt, local) {
        if (t > 0) t -= dt;
        const sh = local && local.face && local.face.headShake;
        if (sh && !prev) { ans = pick(A); t = 4; net.send({ t: "8ball", a: ans }); FX.Sound.boing(); FX.burst(W / 2, H / 2 - 100, ["🎱"], 6, 160); }
        prev = sh;
      },
      draw(ctx) { ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.font = "120px serif"; ctx.fillText("🎱", W / 2, H / 2 - 100); big(ctx, ans || "🎱 Magic 8-Ball", ans ? "" : "ask a yes/no question, then shake your head"); },
    };
  }

  // ---------------- TIC-TAC-TOE (point/pinch a cell, 2-player synced) ------
  function ticTacToeMode() {
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

  // ---------------- COUPLE-NAME MASHUP -------------------------------------
  function mashupMode() {
    let a = "", b = "", out = "press mash 💞";
    const half = (s, front) => front ? s.slice(0, Math.ceil(s.length / 2)) : s.slice(Math.floor(s.length / 2));
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "?";
    return {
      async action(act) {
        if (act !== "go") return;
        if (!a || !b) { const v = await host.ask("Your two names (comma separated):"); if (v) { const p = v.split(","); a = (p[0] || "").trim(); b = (p[1] || "").trim(); } }
        if (a && b) { out = cap(pick([half(a, 1) + half(b, 0), half(b, 1) + half(a, 0), half(a, 1) + half(b, 1)])); net.send({ t: "mash", text: out }); FX.confetti(W / 2, H / 2, 30); FX.Sound.chime(); }
      },
      onNet(m) { if (m.t === "mash") { out = m.text; FX.confetti(W / 2, H / 2, 30); } },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "💞 " + out, "your couple name"); },
    };
  }

  // ---------------- "DAYS TILL WE MEET" COUNTDOWN --------------------------
  function countdownMode() {
    const get = () => { try { return localStorage.getItem("wm_meet"); } catch (_) { return null; } };
    return {
      async action(a) { if (a === "set") { const v = await host.ask("Date you'll next meet (YYYY-MM-DD):", { value: get() || "" }); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) try { localStorage.setItem("wm_meet", v.trim()); } catch (_) {} } },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff"; const d = get();
        if (!d) return big(ctx, "📅 set the date", "press “set date” for your next meetup");
        const days = Math.ceil((new Date(d).getTime() - Date.now()) / 864e5);
        big(ctx, days > 0 ? `${days} days 🥹` : days === 0 ? "TODAY!! 🎉" : "together at last 💕", days > 0 ? "till we're together" : "");
      },
    };
  }

  // ---------------- PICTIONARY (one draws, both say it out loud) -----------
  function pictionaryMode() {
    const WORDS = ["cat", "pizza", "heart", "house", "sun", "star", "fish", "tree", "car", "flower", "moon", "cake", "boat", "dog", "robot", "banana", "guitar", "ghost"];
    let strokes = [], cur = { 0: null, 1: null }, isDrawer = false, word = "", revealed = false, score = 0, flash = "";
    const add = (side, pt) => { let c = cur[side]; if (!c) { c = { side, pts: [] }; strokes.push(c); cur[side] = c; } c.pts.push(pt); };
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
    return {
      enter() { strokes = []; cur = { 0: null, 1: null }; isDrawer = false; word = ""; revealed = false; score = 0; },
      async action(a) {
        if (a === "word") { isDrawer = true; word = pick(WORDS); revealed = false; strokes = []; net.send({ t: "pic-role" }); net.send({ t: "draw-clear" }); }
        else if (a === "reveal") { revealed = true; net.send({ t: "pic-reveal", w: word }); }
        else if (a === "clear") { strokes = []; net.send({ t: "draw-clear" }); }
        else if (a === "guess") { if (isDrawer) return; const g = await host.ask("Your guess:"); if (g) net.send({ t: "pic-guess", g }); }
      },
      onNet(m) {
        if (m.t === "pic-role") { isDrawer = false; word = ""; revealed = false; }
        else if (m.t === "pic-reveal") { word = m.w; revealed = true; }
        else if (m.t === "draw") add(1, { x: m.x, y: m.y });
        else if (m.t === "draw-up") cur[1] = null;
        else if (m.t === "draw-clear") strokes = [];
        else if (m.t === "pic-guess" && isDrawer) { if (norm(m.g) === norm(word)) { revealed = true; score++; net.send({ t: "pic-correct", w: word }); FX.confetti(W / 2, H / 2, 40); FX.Sound.chime(); } else { flash = "❌ “" + m.g + "”"; net.send({ t: "pic-wrong", g: m.g }); } }
        else if (m.t === "pic-correct") { word = m.w; revealed = true; score++; FX.confetti(W / 2, H / 2, 40); FX.Sound.chime(); }
        else if (m.t === "pic-wrong") flash = "❌ " + m.g;
      },
      update(dt, local) { if (isDrawer && local && local.pinch && local.pinch.active) { const pt = { x: local.pinch.x, y: local.pinch.y }; add(0, pt); net.send({ t: "draw", x: pt.x, y: pt.y }); } else if (cur[0]) { cur[0] = null; net.send({ t: "draw-up" }); } },
      draw(ctx) {
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 6;
        for (const st of strokes) { if (st.pts.length < 2) continue; ctx.beginPath(); st.pts.forEach((p, i) => { const c = toCanvas(p, st.side); i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y); }); ctx.stroke(); }
        ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "22px system-ui";
        ctx.fillText(isDrawer && !revealed ? "✏️ draw: " + word + "  (don't say it!)" : revealed ? "it was: " + word + " 🎉" : "🤔 guess what they're drawing!", W / 2, 40);
        ctx.font = "16px system-ui"; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillText("✅ score " + score + (flash ? "   " + flash : ""), W / 2, 66);
        hint(ctx, "Pictionary — drawer: “new word” + pinch to draw • guesser: “guess” (or just say it out loud)");
      },
    };
  }

  // ---------------- SYNCED BREATHING / CALM --------------------------------
  function breathingMode() {
    const seq = [["breathe in 🌬️", 4], ["hold", 2], ["breathe out 😌", 4], ["hold", 2]]; let t = 0;
    return {
      exit() { FX.setTint(120, 170, 255, 0); },
      update(dt) { FX.setTint(120, 170, 255, 0.12); t += dt; },
      draw(ctx) {
        const total = 12, tt = t % total; let acc = 0, idx = 0, pr = 0;
        for (let i = 0; i < seq.length; i++) { if (tt < acc + seq[i][1]) { idx = i; pr = (tt - acc) / seq[i][1]; break; } acc += seq[i][1]; }
        const scale = idx === 0 ? 0.45 + pr * 0.55 : idx === 1 ? 1 : idx === 2 ? 1 - pr * 0.55 : 0.45;
        ctx.save(); ctx.translate(W / 2, H / 2); const r = 90 + scale * 170;
        ctx.fillStyle = "rgba(150,190,255,.15)"; ctx.strokeStyle = "rgba(180,210,255,.9)"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "30px system-ui"; ctx.fillText(seq[idx][0], 0, 0); ctx.restore();
        ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "16px system-ui"; ctx.fillText("breathe together 💙", W / 2, H - 26);
      },
    };
  }

  // ---------------- KARAOKE LYRIC CRAWL ------------------------------------
  function karaokeMode() {
    let lines = [], y = H, speed = 42;
    return {
      async action(a) { if (a === "lyrics") { const v = await host.ask("Paste lyrics (one line per line):", { multiline: true }); if (v) { lines = v.split("\n"); y = H; net.send({ t: "lyrics", text: v }); } } else if (a === "restart") y = H; },
      onNet(m) { if (m.t === "lyrics") { lines = m.text.split("\n"); y = H; } },
      update(dt) { if (lines.length) { y -= speed * dt; if (y < -lines.length * 46) y = H; } },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.font = "30px system-ui";
        if (!lines.length) return big(ctx, "🎤 Karaoke", "paste lyrics to start the crawl");
        lines.forEach((ln, i) => { const ly = y + i * 46; if (ly > -40 && ly < H + 40) { ctx.globalAlpha = 1 - Math.min(1, Math.abs(ly - H * 0.4) / (H * 0.6)); ctx.fillText(ln, W / 2, ly); } });
        ctx.globalAlpha = 1;
      },
    };
  }

  // ---------------- KISS CAM -----------------------------------------------
  function kissCamMode() {
    let phase = "idle", t = 0, success = false;
    return {
      action(a) { if (a === "start") { phase = "count"; t = 3; success = false; net.send({ t: "kisscam" }); } },
      onNet(m) { if (m.t === "kisscam") { phase = "count"; t = 3; success = false; } },
      update(dt, local, remote) {
        if (phase === "count") { t -= dt; if (t <= 0) { phase = "kiss"; t = 4; } }
        else if (phase === "kiss") { t -= dt; const solo = !(remote && remote.present); const mk = local && local.face && local.face.kiss > 0.4, rk = remote && remote.face && remote.face.kiss > 0.4; if ((solo ? mk : mk && rk) && !success) { success = true; FX.flood(0, W, ["💋", "❤️", "💕"], 80, true); FX.burst(W / 2, H / 2, ["💋"], 30, 400); FX.Sound.chime(); } if (t <= 0) phase = "idle"; }
      },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; if (phase === "idle") big(ctx, "💋 Kiss Cam", "press start — then pucker up!"); else if (phase === "count") big(ctx, Math.ceil(t) + "", "get ready to kiss…"); else big(ctx, success ? "awww 😘💕" : "KISS! 💋", success ? "" : "pucker up!"); },
    };
  }

  // ---------------- MOOD LIGHTING (candlelit ambiance) ---------------------
  function moodMode() {
    let acc = 0;
    return {
      exit() { FX.setTint(255, 110, 90, 0); FX.setVignette(0, false); FX.setVignette(1, false); },
      update(dt) { FX.setTint(255, 110, 90, 0.3); FX.setVignette(0, true); FX.setVignette(1, true); acc += dt; if (acc > 0.5) { acc = 0; FX.emoji(rnd(0, W), H + 20, rnd(-10, 10), -rnd(20, 50), pick(["🕯️", "🌹", "✨", "🥂"]), rnd(22, 38), rnd(4, 6), -20, { vr: 0 }); } },
      draw(ctx) { ctx.save(); ctx.globalAlpha = 0.8; ctx.fillStyle = "#fff"; ctx.font = "20px system-ui"; ctx.textAlign = "center"; ctx.fillText("🕯️ mood lighting — just the two of you", W / 2, H - 26); ctx.restore(); },
    };
  }

  // ---------------- PICKUP / COMPLIMENT ROULETTE ---------------------------
  function pickupMode() {
    const SWEET = ["Are you a magnet? I'm drawn to you 🧲", "You're the best part of my day ☀️", "I'd cross any distance for you ✈️", "You make my heart skip 💓", "Cutest human alive, certified ✅", "I like you a lottle — little + a lot 🥰"];
    const SPICY = ["Is it hot in here, or just you? 🥵", "Come closer to the camera… 😏", "You + me + zero distance = trouble 😈", "These lips look lonely — wanna fix that? 💋", "Stop being so distractingly cute 🔥", "I've got plans for you later 😉", "Wish I could close this distance right now 😩💕", "You have no idea what that smile does to me 🫠", "Keep looking at me like that and I won't behave 😈", "Counting down till I can wrap you up 🤗🔥", "That outfit is doing things to me 👀", "Save that energy for when we're in the same room 😏"];
    let text = "press for a line 💘";
    return {
      action(a) { if (a === "go") { text = pick(adult ? SPICY : SWEET); net.send({ t: "pickup", text }); FX.flood(0, W, adult ? ["💋", "🔥"] : ["💘"], 16); FX.Sound.chime(); } },
      onNet(m) { if (m.t === "pickup") { text = m.text; FX.flood(0, W, ["💘"], 14); } },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "💘", text); },
    };
  }

  // ---------------- OUR SONG (mic-reactive vinyl visualizer) ---------------
  function ourSongMode() {
    let title = "our song", spin = 0;
    return {
      async action(a) { if (a === "set") { const v = await host.ask("Name your song:", { value: title }); if (v) { title = v; net.send({ t: "song", title: v }); } } },
      onNet(m) { if (m.t === "song") title = m.title; },
      update(dt) { spin += dt * (1 + FX.getBeat() * 5); },
      draw(ctx) {
        const beat = FX.getBeat();
        ctx.save(); ctx.translate(W / 2, H / 2 - 40); ctx.rotate(spin); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = (120 + beat * 36) + "px serif"; ctx.fillText("💿", 0, 0); ctx.restore();
        ctx.save(); ctx.fillStyle = "#ff7aa8"; const n = 26; for (let i = 0; i < n; i++) { const h = 16 + (Math.sin(spin * 2 + i) * 0.5 + 0.5) * beat * 180 + beat * 50; ctx.fillRect(W / 2 - n * 7 + i * 14, H - 96 - h, 10, h); } ctx.restore();
        ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "bold 34px system-ui"; ctx.fillText("🎶 " + title, W / 2, H * 0.74);
        ctx.font = "16px system-ui"; ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillText("play it out loud — the disc & bars dance to the beat", W / 2, H - 24);
      },
    };
  }

  // ---------------- LOVE MAILBOX (synced notes, saved to inbox) -------------
  function mailboxMode() {
    const load = () => { try { return JSON.parse(localStorage.getItem("wm_inbox") || "[]"); } catch (_) { return []; } };
    const save = (a) => { try { localStorage.setItem("wm_inbox", JSON.stringify(a.slice(-20))); } catch (_) {} };
    let inbox = [];
    return {
      enter() { inbox = load(); },
      async action(a) { if (a === "write") { const v = await host.ask("Write a love note for your partner:", { multiline: true }); if (v) { net.send({ t: "letter", text: v }); FX.travel({ x: W * 0.25, y: H * 0.5 }, () => ({ x: W, y: H * 0.4 }), "💌"); FX.banner(W / 2, H * 0.3, "sent 💌"); FX.Sound.chime(); } } },
      onNet(m) { if (m.t === "letter") { inbox.push({ text: m.text }); save(inbox); FX.travel({ x: 0, y: H * 0.4 }, () => ({ x: W * 0.25, y: H * 0.5 }), "💌", () => { FX.banner(W / 2, H * 0.3, "💌 new note!"); FX.flood(0, W, ["💕"], 14); }); FX.Sound.chime(); } },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "22px system-ui"; ctx.fillText("💌 Love Mailbox — “write” to send a note", W / 2, 48);
        const recent = inbox.slice(-6);
        if (!recent.length) { ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.fillText("notes from your partner appear here 💕", W / 2, H / 2); return; }
        ctx.textAlign = "left"; ctx.font = "19px system-ui";
        recent.forEach((n, i) => { ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillText("💗 " + String(n.text).slice(0, 56), W * 0.16, 110 + i * 42); });
      },
    };
  }

  // ---------------- OUR STARS (shared constellation) -----------------------
  function starsMode() {
    let stars = [], down = false;
    return {
      enter() { stars = []; },
      action(a) { if (a === "clear") { stars = []; net.send({ t: "star-clear" }); } },
      onNet(m) { if (m.t === "star") stars.push({ x: m.x, y: m.y, side: 1 }); else if (m.t === "star-clear") stars = []; },
      update(dt, local) { const d = local && local.pinch && local.pinch.active; if (d && !down) { const p = { x: local.pinch.x, y: local.pinch.y }; stars.push({ x: p.x, y: p.y, side: 0 }); net.send({ t: "star", x: p.x, y: p.y }); FX.Sound.pop(); } down = d; },
      draw(ctx) {
        ctx.save(); ctx.globalAlpha = 0.4; ctx.fillStyle = "#0a0a2a"; ctx.fillRect(0, 0, W, H); ctx.restore();
        ctx.strokeStyle = "rgba(180,200,255,.6)"; ctx.lineWidth = 2; ctx.beginPath();
        stars.forEach((s, i) => { const c = toCanvas(s, s.side); i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y); }); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "22px serif";
        stars.forEach((s) => { const c = toCanvas(s, s.side); ctx.fillText("⭐", c.x, c.y); });
        ctx.font = "20px system-ui"; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillText("✨ our stars — pinch to place a star; together you draw a constellation", W / 2, 40);
      },
    };
  }

  // ---------------- DANCE BATTLE (pose-match scoring) ----------------------
  function danceBattleMode() {
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

  // ---------------- LOVE CALCULATOR ----------------------------------------
  function loveCalcMode() {
    const V = ["soulmates 💞", "written in the stars ✨", "a perfect match 💕", "made for each other 🥰", "the cutest couple 😍", "endgame 💍"];
    let pct = null, verdict = "";
    return {
      async action(a) { if (a === "calc") { const v = await host.ask("Two names (comma separated):"); if (v) { let h = 0; for (const ch of v.toLowerCase().replace(/[^a-z]/g, "")) h = (h * 31 + ch.charCodeAt(0)) % 1000; pct = 75 + h % 26; verdict = pick(V); net.send({ t: "lovecalc", pct, verdict }); FX.flood(0, W, ["❤️", "💕"], 30); FX.Sound.chime(); } } },
      onNet(m) { if (m.t === "lovecalc") { pct = m.pct; verdict = m.verdict; } },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; pct == null ? big(ctx, "❤️ Love Calculator", "press “calc” + enter both names") : big(ctx, pct + "% 💘", verdict); },
    };
  }

  // ---------------- SCRAPBOOK (gallery of Photo Booth shots) ---------------
  function scrapbookMode() {
    let imgs = [], idx = 0;
    const loadThumbs = () => { try { return JSON.parse(localStorage.getItem("wm_scrapbook") || "[]"); } catch (_) { return []; } };
    const srcs = () => (host && host.moments && host.moments.length) ? host.moments.map((m) => m.url) : loadThumbs();   // prefer full-res session moments
    return {
      enter() { imgs = srcs().map((u) => { const i = new Image(); i.src = u; return i; }); idx = Math.max(0, imgs.length - 1); },
      action(a) {
        if (a === "prev") idx = Math.max(0, idx - 1);
        else if (a === "next") idx = Math.min(imgs.length - 1, idx + 1);
        else if (a === "save") { const im = imgs[idx]; if (im && im.src) { const el = document.createElement("a"); el.href = im.src; el.download = "webcam-magic-" + (idx + 1) + ".jpg"; el.click(); } }
        else if (a === "all") { imgs.forEach((im, k) => { if (im && im.src) setTimeout(() => { const el = document.createElement("a"); el.href = im.src; el.download = "webcam-magic-" + (k + 1) + ".jpg"; el.click(); }, k * 250); }); }
        else if (a === "clear") { try { localStorage.removeItem("wm_scrapbook"); } catch (_) {} if (host && host.moments) host.moments.length = 0; imgs = []; idx = 0; }
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        if (!imgs.length) return big(ctx, "📔 Scrapbook", "close your eyes to snap moments — they save here");
        const im = imgs[idx];
        if (im && im.complete && im.naturalWidth) { const w = W * 0.5, h = w * 9 / 16, x = W / 2 - w / 2, y = H / 2 - h / 2 - 20; ctx.save(); ctx.fillStyle = "#fff"; ctx.fillRect(x - 10, y - 10, w + 20, h + 50); try { ctx.drawImage(im, x, y, w, h); } catch (_) {} ctx.restore(); }
        ctx.fillStyle = "#fff"; ctx.font = "20px system-ui"; ctx.fillText(`📔 ${idx + 1} / ${imgs.length}`, W / 2, H * 0.84);
        hint(ctx, "Scrapbook — ◀ ▶ to flip through your memories");
      },
    };
  }

  // ---------------- BUCKET LIST (shared, pinch to check off) ---------------
  function bucketMode() {
    let items = [], down = false;
    const load = () => { try { return JSON.parse(localStorage.getItem("wm_bucket") || "[]"); } catch (_) { return []; } };
    const save = () => { try { localStorage.setItem("wm_bucket", JSON.stringify(items)); } catch (_) {} };
    const rowY = (i) => 120 + i * 46;
    return {
      enter() { items = load(); },
      async action(a) { if (a === "add") { const v = await host.ask("Add something to do together:"); if (v) { items.push({ t: v, done: false }); save(); net.send({ t: "bucket", items }); } } else if (a === "clear") { items = []; save(); net.send({ t: "bucket", items }); } },
      onNet(m) { if (m.t === "bucket") { items = m.items || []; save(); } },
      update(dt, local) {
        const d = local && local.pinch && local.pinch.active;
        if (d && !down) { const p = toCanvas(local.pinch, 0); items.forEach((it, i) => { if (Math.abs(p.y - rowY(i)) < 22 && p.x > W * 0.1 && p.x < W * 0.75) { it.done = !it.done; save(); net.send({ t: "bucket", items }); FX.Sound.pop(); if (it.done) FX.sparkleAt(p.x, p.y, 6); } }); }
        down = d;
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "24px system-ui"; ctx.fillText("🪣 Our Bucket List", W / 2, 64);
        if (!items.length) { ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "20px system-ui"; ctx.fillText("press “add” to dream up things to do together 💫", W / 2, H / 2); return; }
        ctx.textAlign = "left"; ctx.font = "22px system-ui";
        items.forEach((it, i) => { ctx.fillStyle = it.done ? "rgba(150,255,170,.95)" : "#fff"; ctx.fillText((it.done ? "✅ " : "⬜ ") + String(it.t).slice(0, 48), W * 0.16, rowY(i)); });
        hint(ctx, "Bucket List — “add” items • pinch an item to check it off (synced)");
      },
    };
  }

  // ---------------- LOVERS' DICE (action × spot) --------------------------
  function loversDiceMode() {
    const ACT = ["kiss 💋", "blow a kiss to 😘", "nibble 😏", "trace a finger down 👆", "whisper to 🤫", "slow-kiss 💋", "leave a mark on 🔥", "nuzzle 🫠"];
    const SPOT = ["the lips 👄", "the neck 🔥", "a cheek 😊", "the collarbone ✨", "an ear 👂", "a hand ✋", "the forehead 😌", "the jawline 😏"];
    let a = "", s = "", t = 0, phase = "idle";
    return {
      action(x) { if (x === "roll") { a = pick(ACT); s = pick(SPOT); phase = "show"; t = 5; net.send({ t: "dice", a, s }); FX.flood(0, W, ["💋", "🔥"], 16); FX.Sound.chime(); } },
      onNet(m) { if (m.t === "dice") { a = m.a; s = m.s; phase = "show"; t = 5; } },
      update(dt) { if (t > 0) t -= dt; },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.font = "76px serif";
        ctx.fillText("🎲", W / 2 - 70, H / 2 - 100); ctx.fillText("🎲", W / 2 + 70, H / 2 - 100);
        phase === "idle" ? big(ctx, "🎲 Lovers' Dice", "press roll — then act it out 😏") : big(ctx, a + " " + s, "act it out 😏");
      },
    };
  }

  // ---------------- WOULD YOU RATHER (flirty, finger vote) -----------------
  function wyrMode() {
    const Q = [["cozy night in 🛋️", "wild night out 🎉"], ["little spoon 🥄", "big spoon 🤗"], ["forehead kisses 😌", "neck kisses 🔥"], ["slow dance 💃", "pillow fight 🪶"], ["morning cuddles ☀️", "midnight talks 🌙"], ["lights on 💡", "lights off 🌙"], ["tease 😏", "be teased 🫠"], ["make the first move 😉", "be swept off your feet 🥰"]];
    let q = Q[0], phase = "idle", t = 0, mine = 1, theirs = 1, res = "";
    const start = (i) => { q = Q[i]; phase = "count"; t = 3; res = ""; };
    return {
      action(a) { if (a === "go") { const i = Math.floor(Math.random() * Q.length); start(i); net.send({ t: "wyr", q: i }); } },
      onNet(m) { if (m.t === "wyr") start(m.q); },
      update(dt, local, remote) {
        if (phase === "count") { t -= dt; if (t <= 0) { mine = local && local.fingers >= 2 ? 2 : 1; theirs = remote && remote.fingers >= 2 ? 2 : 1; res = mine === theirs ? "same taste 💕" : "opposites attract 😏"; if (mine === theirs) FX.flood(0, W, ["💕"], 26); phase = "done"; t = 3.5; } }
        else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; }
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        if (phase === "idle") big(ctx, "😏 Would You Rather", "press go — ☝️ 1 finger = left, ✌️ 2 = right");
        else if (phase === "count") { ctx.font = "bold 32px system-ui"; ctx.fillText("1️⃣ " + q[0], W / 2, H * 0.4); ctx.fillText("2️⃣ " + q[1], W / 2, H * 0.52); ctx.font = "20px system-ui"; ctx.fillText("vote in… " + Math.ceil(t), W / 2, H * 0.64); }
        else big(ctx, "you: " + (mine === 1 ? q[0] : q[1]), res);
      },
    };
  }

  // ---------------- NEVER HAVE I EVER (flirty confessions) -----------------
  function neverMode() {
    const N = ["fantasized about our next date 😏", "fallen asleep on call with you 🥱💕", "re-read our old texts 📱", "stared at your photo too long 👀", "wanted to kiss you through the screen 💋", "had a dream about you 😴💕", "gotten butterflies from one text 🦋", "wanted to skip everything just to see you ✈️", "undressed you with my eyes 😳😏", "rehearsed what I'd do when I see you 🫠"];
    let text = "";
    return {
      action(a) { if (a === "next") { text = pick(N); net.send({ t: "never", text }); FX.flood(0, W, ["🙈", "💕"], 12); } },
      onNet(m) { if (m.t === "never") text = m.text; },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "24px system-ui"; ctx.textBaseline = "middle"; ctx.fillText("🙈 Never have I ever…", W / 2, H * 0.4); ctx.font = "bold 30px system-ui"; ctx.fillText(text || "press next", W / 2, H * 0.52); ctx.font = "17px system-ui"; ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fillText("say 'I have' or 'I haven't' 😏", W / 2, H * 0.64); },
    };
  }

  // ---------------- DARE ROULETTE (bold dares, spins) ----------------------
  function dareRouletteMode() {
    const D = ["slow-kiss the camera 💋", "bite your lip 😏", "whisper a secret 🤫", "give a 'come here' look 😉", "trace your lips 💋", "best bedroom eyes 😴😏", "undo a button 😉", "strike a sultry pose 🔥", "blow a slow kiss 😘", "peek over your shoulder 😏", "do a slow hair flip 💇", "send your most wanted look 🥵"];
    let phase = "idle", t = 0, idx = 0, shown = "spin for a dare 🌶️";
    const start = (i) => { idx = i; phase = "spin"; t = 1.6; };
    return {
      action(a) { if (a === "spin" && phase !== "spin") { const i = Math.floor(Math.random() * D.length); start(i); net.send({ t: "roul", i }); } },
      onNet(m) { if (m.t === "roul") start(m.i); },
      update(dt) { if (phase === "spin") { t -= dt; if (t <= 0) { shown = D[idx]; phase = "done"; FX.flood(0, W, ["🌶️", "🔥", "💋"], 24); FX.Sound.chime(); } else if (t > 0.2) shown = D[Math.floor(Math.random() * D.length)]; } },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "🌶️ " + shown, phase === "done" ? "do it 😏" : "press spin"); },
    };
  }

  // helpers shared by modes
  function cursorPx(g, side) { const c = cursor(g); return c ? toCanvas(c, side) : null; }
  function pointPx(g, side) { if (g && g.point && g.point.active) return toCanvas(g.point, side); return cursorPx(g, side); }
  // ================= GESTURE / VIDEO-DRIVEN GAMES =========================
  // 🎯 TARGET TRACK — keep your fingertip on the moving ring (uses your hand + video position)
  function targetTrackMode() {
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
  function simonMode() {
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
  function balloonMode() {
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
  function reactionMode() {
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
  function winkBattleMode() {
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

  // 🎭 CHARADES — one acts a prompt, the other guesses out loud
  function charadesMode() {
    const P = ["cat 🐱", "pizza 🍕", "swimming 🏊", "sleeping 😴", "playing guitar 🎸", "superhero 🦸", "dancing 💃", "fishing 🎣", "driving 🚗", "brushing teeth 🪥", "taking a selfie 🤳", "cooking 🍳", "crying 😭", "boxing 🥊", "an airplane ✈️", "a monkey 🐒", "a robot 🤖", "eating spaghetti 🍝"];
    let isActor = false, word = "", revealed = false;
    return {
      enter() { isActor = false; word = ""; revealed = false; },
      action(a) { if (a === "new") { isActor = true; word = pick(P); revealed = false; net.send({ t: "char-role" }); } else if (a === "reveal") { revealed = true; net.send({ t: "char-rev", w: word }); } },
      onNet(m) { if (m.t === "char-role") { isActor = false; word = ""; revealed = false; } else if (m.t === "char-rev") { word = m.w; revealed = true; } },
      draw(ctx) { if (isActor && !revealed) big(ctx, "Act out: " + word, "no talking — use gestures & face!"); else if (revealed) big(ctx, "it was: " + word + " 🎉", ""); else big(ctx, "🎭 Charades", "your partner is acting — guess out loud!"); hint(ctx, "“new prompt” to be the actor • “reveal” the answer"); },
    };
  }

  // 🧊 FREEZE — hold perfectly still after FREEZE (uses hand motion)
  function freezeMode() {
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
  function rhythmMode() {
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

  // 🙏 MAKE A WISH — both press palms together
  function wishMode() {
    let t = 0;
    return {
      update(dt, local, remote) { if (t > 0) { t -= dt; return; } const solo = !(remote && remote.present); const lp = local && local.two && local.two.prayer, rp = solo ? lp : (remote && remote.two && remote.two.prayer); if (lp && rp) { FX.travel({ x: 20, y: 40 }, () => ({ x: W - 20, y: H * 0.5 }), "🌠", () => FX.burst(W - 60, H * 0.5, ["✨", "⭐", "💫"], 14, 220)); FX.flood(0, W, ["✨", "💫"], 20); FX.banner(W / 2, H * 0.3, "wish made together 🌠"); FX.Sound.chime(); t = 4; } },
      draw(ctx) { big(ctx, "🙏 Make a Wish", "both press your palms together"); },
    };
  }

  // 🙌 HANDS UP — both raise hands to hype
  function handsUpMode() {
    let combo = 0, prev = false;
    return {
      update(dt, local, remote) { const solo = !(remote && remote.present); const l = local && local.two && local.two.handsUp, r = solo ? l : (remote && remote.two && remote.two.handsUp); const both = l && r; if (both && !prev) { combo++; FX.flood(0, W, ["🙌", "🎉", "✨", "🥳"], 40); FX.burst(W / 2, H / 2, ["🙌"], 16); FX.Sound.chime(); } prev = both; },
      draw(ctx) { big(ctx, "🙌 Hands Up! " + (combo ? "×" + combo : ""), "both raise your hands to celebrate 🥳"); },
    };
  }

  // 💞 36 QUESTIONS (Arthur Aron — "the ones that lead to love")
  function q36Mode() {
    const Q = ["Given the choice of anyone in the world, whom would you want as a dinner guest?", "Would you like to be famous? In what way?", "Before making a phone call, do you ever rehearse what you'll say? Why?", "What would constitute a “perfect” day for you?", "When did you last sing to yourself? To someone else?", "If you could live to 90 keeping the mind or body of a 30-year-old for the last 60 years — which?", "Do you have a secret hunch about how you'll die?", "Name three things you and I appear to have in common.", "For what in your life do you feel most grateful?", "If you could change anything about how you were raised, what would it be?", "Take 4 minutes to tell your partner your life story in as much detail as possible.", "If you could wake up tomorrow having gained one quality or ability, what would it be?", "If a crystal ball could tell you the truth about anything, what would you want to know?", "Is there something you've dreamt of doing for a long time? Why haven't you?", "What is the greatest accomplishment of your life?", "What do you value most in a friendship?", "What is your most treasured memory?", "What is your most terrible memory?", "If you knew you'd die in a year, would you change how you live? Why?", "What does friendship mean to you?", "What roles do love and affection play in your life?", "Alternate sharing something you consider a positive characteristic of your partner (5 total).", "How close and warm is your family? Was your childhood happier than others'?", "How do you feel about your relationship with your mother?", "Make three true “we” statements (e.g. “We are both in this room feeling…”).", "Complete this sentence: “I wish I had someone with whom I could share…”", "If you were to become close friends, what's important for them to know?", "Tell your partner what you like about them — be honest, say things you wouldn't to a stranger.", "Share an embarrassing moment in your life.", "When did you last cry in front of another person? By yourself?", "Tell your partner something you already like about them.", "What, if anything, is too serious to be joked about?", "If you died this evening with no chance to communicate, what would you most regret not telling someone?", "Your house is on fire. After loved ones & pets, you can save one item — what, and why?", "Of all the people in your family, whose death would you find most disturbing? Why?", "Share a personal problem and ask your partner how they'd handle it."];
    let i = 0;
    return {
      onNet(m) { if (m.t === "q36") i = m.i; },
      action(a) { if (a === "next") { i = Math.min(Q.length - 1, i + 1); net.send({ t: "q36", i }); } else if (a === "prev") { i = Math.max(0, i - 1); net.send({ t: "q36", i }); } },
      draw(ctx) { const set = i < 12 ? "Set I" : i < 24 ? "Set II" : "Set III"; big(ctx, Q[i], `36 Questions • ${set} • ${i + 1}/36`); hint(ctx, "take turns answering honestly • ◀ ▶ to move • finish with 4 min of eye contact 👀"); },
    };
  }

  // 💬 DEEP TALK — lighter connection prompts
  function deepTalkMode() {
    const Q = ["What made you smile today?", "What's a small thing I do that you love?", "Describe our perfect lazy Sunday.", "What are you most looking forward to about seeing me?", "What's a memory of us you replay often?", "If we could teleport anywhere right now, where?", "What's something new you want us to try together?", "What did you first find attractive about me?", "What song reminds you of me?", "What are you grateful for right now?", "How can I support you better this week?", "What's a dream you haven't told me yet?", "What would our ideal date night look like tonight?", "What's your favorite thing about us?", "What's a tiny win you had recently?", "What do you need more of from me?"];
    let text = "press next 💬";
    return {
      onNet(m) { if (m.t === "dt") text = m.text; },
      action(a) { if (a === "next") { text = pick(Q); net.send({ t: "dt", text }); FX.flood(0, W, ["💬", "💕"], 10); } },
      draw(ctx) { big(ctx, "💬", text); hint(ctx, "“next” for a new question — take turns answering"); },
    };
  }

  // 🙋 20 QUESTIONS — one thinks of something, the other asks yes/no
  function twentyQMode() {
    let count = 0, asker = 1;
    return {
      onNet(m) { if (m.t === "tq") { count = m.c; asker = m.a; } },
      action(a) { if (a === "ask") { count = Math.min(20, count + 1); net.send({ t: "tq", c: count, a: asker }); } else if (a === "swap") { asker = asker ? 0 : 1; count = 0; net.send({ t: "tq", c: count, a: asker }); } else if (a === "reset") { count = 0; net.send({ t: "tq", c: count, a: asker }); } },
      draw(ctx) { const iAsk = asker === meIdx(); big(ctx, count + " / 20", iAsk ? "you ask the yes/no questions" : "think of something — they'll guess!"); hint(ctx, "“asked” after each question • “swap” to switch roles"); },
    };
  }

  // 🕵️ TWO TRUTHS & A LIE
  function twoTruthsMode() {
    let lines = [], lie = -1, revealed = false;
    return {
      enter() { lines = []; lie = -1; revealed = false; },
      async action(a) {
        if (a === "enter") { const v = await host.ask("Two truths and a lie — 3 lines, put your LIE on the LAST line:", { multiline: true }); if (v) { const L = v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3); if (L.length === 3) { const order = [0, 1, 2].sort(() => Math.random() - 0.5); lie = order.indexOf(2); lines = order.map((k) => L[k]); revealed = false; net.send({ t: "tt", lines, lie }); } } }
        else if (a === "reveal") { revealed = true; net.send({ t: "tt-rev" }); }
      },
      onNet(m) { if (m.t === "tt") { lines = m.lines; lie = m.lie; revealed = false; } else if (m.t === "tt-rev") revealed = true; },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        if (!lines.length) return big(ctx, "🕵️ Two Truths & a Lie", "press “enter” to write yours");
        outline(ctx, "🕵️ Which one is the lie?", W / 2, H * 0.26, 26);
        lines.forEach((l, i) => { ctx.font = "22px system-ui"; ctx.fillStyle = revealed && i === lie ? "#ff8a8a" : "#fff"; ctx.textBaseline = "middle"; ctx.fillText(`${i + 1}.  ${l.slice(0, 46)}${revealed && i === lie ? "   ← the lie" : ""}`, W / 2, H * 0.42 + i * 44); });
        hint(ctx, revealed ? "revealed! “enter” for a new round" : "guess out loud, then “reveal”");
      },
    };
  }

  // 📖 STORY BUILDER — alternate a sentence each
  function storyMode() {
    let lines = [];
    return {
      enter() { lines = []; },
      async action(a) { if (a === "add") { const v = await host.ask("Add the next sentence to your story:"); if (v) { lines.push(v.trim()); net.send({ t: "st-add", lines }); } } else if (a === "clear") { lines = []; net.send({ t: "st-add", lines }); } },
      onNet(m) { if (m.t === "st-add") lines = m.lines || []; },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; outline(ctx, "📖 Our Story", W / 2, 60, 26);
        if (!lines.length) { ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "20px system-ui"; ctx.fillText("take turns — “add” a sentence each ✍️", W / 2, H / 2); return; }
        const show = lines.slice(-8); ctx.font = "20px system-ui";
        show.forEach((l, i) => { ctx.fillStyle = (lines.length - show.length + i) % 2 ? "#ffd2e0" : "#cfe0ff"; ctx.fillText(l.slice(0, 72), W / 2, 108 + i * 40); });
        hint(ctx, "alternate turns • “add” a sentence to keep it going");
      },
    };
  }

  // 🧠 TELEPATHY — both name the same thing in a category
  function telepathyMode() {
    const CATS = ["a fruit 🍓", "a color 🎨", "a movie 🎬", "a place to travel ✈️", "an animal 🐾", "a date idea 💕", "a pizza topping 🍕", "a song 🎵", "a number 1–10 🔢", "a weekend plan 🌤️"];
    let cat = "", mine = "", theirs = "", phase = "idle";
    const check = () => { if (mine && theirs) { phase = "reveal"; if (mine.toLowerCase() === theirs.toLowerCase()) { FX.flood(0, W, ["🎉", "💕", "✨"], 40); FX.Sound.chime(); } } };
    const start = (c) => { cat = c; mine = ""; theirs = ""; phase = "answer"; };
    return {
      onNet(m) { if (m.t === "tele-go") start(m.c); else if (m.t === "tele-ans") { theirs = m.w; check(); } },
      async action(a) { if (a === "go") { const c = pick(CATS); start(c); net.send({ t: "tele-go", c }); } else if (a === "answer") { if (phase !== "answer") return; const v = await host.ask("Think alike! Name " + cat + ":"); if (v) { mine = v.trim(); net.send({ t: "tele-ans", w: mine }); check(); } } },
      draw(ctx) {
        if (phase === "idle") return big(ctx, "🧠 Telepathy", "press “new”, then both name the same thing");
        if (phase === "reveal") { const match = mine.toLowerCase() === theirs.toLowerCase(); big(ctx, `${mine || "?"}  •  ${theirs || "?"}`, match ? "🎉 telepathy! you matched" : "😜 not this time — “new” to retry"); }
        else big(ctx, "Name: " + cat, mine ? "waiting for partner…" : "press “answer” to lock it in");
      },
    };
  }

  // active player's cursor mapped to the FULL canvas (for shared centred boards)
  function activeCur(local, remote, turnIdx) { const g = turnIdx === 0 ? local : remote; const c = cursor(g); return c ? { x: c.x * W, y: c.y * H, down: c.down } : null; }

  // 🔒 VAULT — co-op: each of you sees only HALF the code, combine to unlock
  function vaultMode() {
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

  // 🔴 CONNECT FOUR — drop by pointing to a column & pinching
  function connect4Mode() {
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
  function memoryMode() {
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
  function triviaMode() {
    const Q = [{ q: "How many hearts does an octopus have?", o: ["1", "2", "3"], a: 2 }, { q: "Tallest animal?", o: ["Elephant", "Giraffe", "Horse"], a: 1 }, { q: "The Red Planet?", o: ["Venus", "Mars", "Jupiter"], a: 1 }, { q: "Strings on a guitar?", o: ["4", "6", "8"], a: 1 }, { q: "Largest ocean?", o: ["Atlantic", "Indian", "Pacific"], a: 2 }, { q: "Which is a fruit?", o: ["Tomato", "Carrot", "Onion"], a: 0 }, { q: "Fastest land animal?", o: ["Cheetah", "Lion", "Horse"], a: 0 }, { q: "Colors in a rainbow?", o: ["5", "6", "7"], a: 2 }, { q: "Freezing point of water °C?", o: ["0", "10", "32"], a: 0 }, { q: "How many continents?", o: ["5", "7", "9"], a: 1 }];
    let i = 0, phase = "idle", t = 0, score = [0, 0], mine = -1, theirs = -1, bc = 0;
    const start = (idx) => { i = idx; phase = "count"; t = 5; mine = -1; theirs = -1; };
    return {
      action(a) { if (a === "go") { const idx = Math.floor(Math.random() * Q.length); start(idx); net.send({ t: "trv-go", i: idx }); } },
      onNet(m) { if (m.t === "trv-go") start(m.i); else if (m.t === "trv") { i = m.i; phase = m.p; score = m.s; mine = m.mn ?? mine; theirs = m.th ?? theirs; } },
      update(dt, local, remote) {
        if (!authority) return;
        if (phase === "count") { t -= dt; if (t <= 0) { const fp = (g) => g && g.fingers ? Math.min(3, g.fingers) - 1 : -1; mine = fp(local); theirs = fp(remote); if (mine === Q[i].a) score[0]++; if (theirs === Q[i].a) score[1]++; phase = "reveal"; t = 4; net.send({ t: "trv", i, p: phase, s: score, mn: mine, th: theirs }); } }
        else if (phase === "reveal") { t -= dt; if (t <= 0) { phase = "idle"; net.send({ t: "trv", i, p: phase, s: score }); } }
      },
      draw(ctx) {
        scoreboard(ctx, score, null, "Trivia");
        if (phase === "idle") return big(ctx, "🧩 Trivia", "press “go” — answer with 1, 2, or 3 fingers");
        const q = Q[i]; ctx.textAlign = "center"; ctx.fillStyle = "#fff"; outline(ctx, q.q, W / 2, H * 0.32, 26);
        q.o.forEach((o, k) => { const hit = phase === "reveal" && k === q.a; ctx.font = (hit ? "bold " : "") + "24px system-ui"; ctx.fillStyle = hit ? "#8dffb0" : "#fff"; ctx.textBaseline = "middle"; ctx.fillText(`${k + 1}.  ${o}${hit ? "  ✓" : ""}`, W / 2, H * 0.46 + k * 42); });
        if (phase === "count") pill(ctx, "answer in… " + Math.ceil(t), W / 2, H * 0.78, 16);
      },
    };
  }

  // 🤔 HOW WELL DO YOU KNOW ME — one answers truth, the other guesses
  function howWellMode() {
    const Q = ["my favorite food?", "my dream vacation?", "my biggest fear?", "my comfort movie?", "my go-to karaoke song?", "my ideal Sunday?", "my hidden talent?", "the best gift I could get?", "my favorite thing about you?", "my most-used emoji?"];
    let q = "", truth = "", guess = "", phase = "idle", answerer = 0;
    const check = () => { if (truth && guess) phase = "reveal"; };
    return {
      onNet(m) { if (m.t === "hw-go") { q = m.q; answerer = m.an; truth = ""; guess = ""; phase = "play"; } else if (m.t === "hw-truth") { truth = m.v; check(); } else if (m.t === "hw-guess") { guess = m.v; check(); } },
      async action(a) {
        if (a === "go") { q = pick(Q); answerer = meIdx(); truth = ""; guess = ""; phase = "play"; net.send({ t: "hw-go", q, an: answerer }); }
        else if (a === "answer") { if (phase !== "play") return; if (meIdx() === answerer) { const v = await host.ask("(secret) Your true answer — " + q); if (v) { truth = v.trim(); net.send({ t: "hw-truth", v: truth }); check(); } } else { const v = await host.ask("Guess their answer — " + q); if (v) { guess = v.trim(); net.send({ t: "hw-guess", v: guess }); check(); } } }
      },
      draw(ctx) {
        if (phase === "idle") return big(ctx, "🤔 How Well Do You Know Me", "press “new”, then both press “answer”");
        if (phase === "reveal") { const match = truth.toLowerCase() === guess.toLowerCase(); return big(ctx, `truth: ${truth}   guess: ${guess}`, match ? "spot on! 💞" : "close? talk it out 😄"); }
        big(ctx, q, meIdx() === answerer ? "you answer truthfully (secret)" : "you guess their answer");
      },
    };
  }

  // ⚖️ WHO'S MORE LIKELY — both vote ☝️you / ✌️me
  function whoMoreMode() {
    const Q = ["to text first 📱", "to cry at a movie 😭", "to burn dinner 🔥", "to fall asleep first 😴", "to plan the trip ✈️", "to win an argument 😤", "to forget an anniversary 🙈", "to say “I love you” more 💕", "to be late ⏰", "to start a food fight 🍝", "to send memes at 2am 😂", "to give the better massage 💆"];
    let q = "", phase = "idle", t = 0, mine = 0, theirs = 0;
    const start = (x) => { q = x; phase = "count"; t = 4; mine = 0; theirs = 0; };
    return {
      onNet(m) { if (m.t === "wm") start(m.q); },
      action(a) { if (a === "go") { const x = pick(Q); start(x); net.send({ t: "wm", q: x }); } },
      update(dt, local, remote) {
        if (!authority) return;
        if (phase === "count") { t -= dt; if (t <= 0) { mine = local && local.fingers >= 2 ? 2 : 1; theirs = remote && remote.fingers >= 2 ? 2 : 1; phase = "done"; t = 4; } }
        else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; }
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        if (phase === "idle") return big(ctx, "⚖️ Who's More Likely…", "press “go” • vote ☝️ you / ✌️ me");
        if (phase === "count") { outline(ctx, "Who's more likely " + q, W / 2, H * 0.4, 26); pill(ctx, "vote ☝️you / ✌️me • " + Math.ceil(t), W / 2, H * 0.56, 16); return; }
        const agree = mine !== theirs ? "you agree! 😄" : "you disagree — debate! 😆";  // opposite finger picks = same person
        big(ctx, "Who's more likely " + q, agree);
      },
    };
  }

  // 🔀 THIS OR THAT — quick preference match (☝️ / ✌️)
  function thisOrThatMode() {
    const P = [["☕ coffee", "🍵 tea"], ["🌊 beach", "⛰️ mountains"], ["🐶 dogs", "🐱 cats"], ["🌅 early bird", "🦉 night owl"], ["🍕 pizza", "🌮 tacos"], ["🎬 movie in", "🍸 night out"], ["📱 text", "📞 call"], ["🍫 sweet", "🧂 salty"], ["🏖️ summer", "❄️ winter"], ["🎧 music", "🎙️ podcasts"]];
    let p = null, phase = "idle", t = 0, mine = 0, theirs = 0, streak = 0;
    const start = (x) => { p = x; phase = "count"; t = 3; mine = 0; theirs = 0; };
    return {
      onNet(m) { if (m.t === "tot") { p = P[m.i]; start(P[m.i]); } },
      action(a) { if (a === "go") { const i = Math.floor(Math.random() * P.length); start(P[i]); net.send({ t: "tot", i }); } },
      update(dt, local, remote) {
        if (!authority) return;
        if (phase === "count") { t -= dt; if (t <= 0) { mine = local && local.fingers >= 2 ? 2 : 1; theirs = remote && remote.fingers >= 2 ? 2 : 1; if (mine === theirs) streak++; else streak = 0; phase = "done"; t = 3; } }
        else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; }
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        if (!p) return big(ctx, "🔀 This or That", "press “go” • ☝️ left / ✌️ right");
        if (phase === "count") { outline(ctx, `☝️ ${p[0]}   vs   ✌️ ${p[1]}`, W / 2, H * 0.42, 26); pill(ctx, "pick! • " + Math.ceil(t), W / 2, H * 0.56, 16); return; }
        const match = mine === theirs;
        big(ctx, match ? "match! 💕" : "opposites 😜", `you: ${mine === 1 ? p[0] : p[1]} • match streak ${streak}`);
      },
    };
  }

  // 🔡 HANGMAN — one sets a word, the other guesses letters
  function hangmanMode() {
    let word = "", guessed = [], wrong = 0, setter = 0, phase = "idle";
    const masked = () => word.split("").map((c) => c === " " ? "  " : (guessed.includes(c) ? c : "_")).join(" ");
    return {
      onNet(m) { if (m.t === "hm-word") { word = m.w; guessed = []; wrong = 0; setter = m.s; phase = "play"; } else if (m.t === "hm-g") { guessed = m.g; wrong = m.wr; if (word && word.split("").every((c) => c === " " || guessed.includes(c))) phase = "win"; if (wrong >= 6) phase = "lose"; } },
      async action(a) {
        if (a === "set") { const v = await host.ask("Set a secret word or short phrase:"); if (v) { word = v.toLowerCase().trim(); guessed = []; wrong = 0; setter = meIdx(); phase = "play"; net.send({ t: "hm-word", w: word, s: setter }); } }
        else if (a === "guess") { if (phase !== "play" || meIdx() === setter) return; const v = await host.ask("Guess a letter:"); if (v) { const c = v.toLowerCase().trim()[0]; if (c && !guessed.includes(c)) { guessed.push(c); if (!word.includes(c)) wrong++; net.send({ t: "hm-g", g: guessed, wr: wrong }); if (word.split("").every((x) => x === " " || guessed.includes(x))) { phase = "win"; FX.confetti(W / 2, H / 2, 30); } else if (wrong >= 6) phase = "lose"; } } }
      },
      draw(ctx) {
        if (phase === "idle") return big(ctx, "🔡 Hangman", "one presses “set”, the other “guess”");
        if (meIdx() === setter && phase === "play") return big(ctx, "🤫 you set the word", "your partner is guessing…");
        const hearts = "❤️".repeat(Math.max(0, 6 - wrong)) + "🖤".repeat(Math.min(6, wrong));
        big(ctx, phase === "win" ? "solved! 🎉 " + word : phase === "lose" ? "out of tries 😅 " + word : masked(), phase === "play" ? "guesses left: " + hearts : "“set” a new word");
      },
    };
  }

  // ================= NEW SENSES (voice / objects / phone sensors) =========
  // 🗣️ SAY IT FIRST — first to SAY the word out loud (Web Speech API)
  function sayItMode() {
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
  function decipherMode() {
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
  function treasureMode() {
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
  function distanceMode() {
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
  function tiltMode() {
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
        if (Math.hypot(ball.x - target.x, ball.y - target.y) < .08) { my++; nt(); FX.sparkleAt(mySide === 0 ? W * .25 : W * .75, H * .5, 8); FX.Sound.pop(); }
        bc += dt; if (bc > .25) { bc = 0; net.send({ t: "tilt", s: my }); }
      },
      draw(ctx) {
        const bp = toCanvas(ball, mySide), tp = toCanvas(target, mySide);
        ctx.save(); ctx.strokeStyle = "#7cff9d"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(tp.x, tp.y, 26, 0, 7); ctx.stroke(); ctx.fillStyle = "#ffd24b"; ctx.beginPath(); ctx.arc(bp.x, bp.y, 20, 0, 7); ctx.fill(); ctx.restore();
        scoreboard(ctx, [meIdx() === 0 ? my : their, meIdx() === 0 ? their : my], null, "Tilt Maze 📱");
        hint(ctx, host.sensors.on ? "tilt your phone to roll into the ring" : "press “enable” (phones), then tilt");
      },
    };
  }

  // 📳 SHAKE RACE — shake your phone the most in 5s
  function shakeMode() {
    let phase = "idle", t = 0, my = 0, their = 0, cool = 0;
    return {
      enter() { phase = "idle"; my = 0; their = 0; },
      action(a) { if (a === "enable") host.requestSensors(); else if (a === "go") { phase = "race"; t = 5; my = 0; net.send({ t: "shk-go" }); } },
      onNet(m) { if (m.t === "shk-go") { phase = "race"; t = 5; my = 0; } else if (m.t === "shk") their = m.s; },
      update(dt) { if (phase === "race") { t -= dt; cool -= dt; if ((host.sensors.shake || 0) > 28 && cool <= 0) { my++; cool = 0.18; FX.sparkleAt(mySide === 0 ? W * .25 : W * .75, H * .5, 6); net.send({ t: "shk", s: my }); } if (t <= 0) { phase = "done"; t = 3; } } else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; } },
      draw(ctx) { scoreboard(ctx, [meIdx() === 0 ? my : their, meIdx() === 0 ? their : my], phase === "race" ? t : null, "Shake Race 📳"); if (phase === "idle") big(ctx, "📳 Shake Race", "“enable” (phones) then “go” — shake fastest!"); else if (phase === "race") big(ctx, "SHAKE! 📳", "go go go"); else big(ctx, my > their ? "You win! 🎉" : my < their ? "Partner wins" : "tie!", ""); },
    };
  }

  // 🧍 POSE PARTY — strike the called-out body pose first (full-body pose)
  function poseMode() {
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

  // 🐤 MOUTH FLAPPY — open your mouth to flap through gaps (face input)
  function flappyMode() {
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
        const S = mySide; ctx.save();
        for (const p of pipes) { const x = toCanvas({ x: p.x, y: 0 }, S).x, gy = p.gap * H; ctx.fillStyle = "rgba(90,200,120,.8)"; ctx.fillRect(x - 22, 0, 44, gy - 90); ctx.fillRect(x - 22, gy + 90, 44, H - gy - 90); }
        const bp = toCanvas({ x: .3, y: bird.y }, S); ctx.font = "40px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🐤", bp.x, bp.y); ctx.restore();
        scoreboard(ctx, [meIdx() === 0 ? best : their, meIdx() === 0 ? their : best], null, "Mouth Flappy 🐤");
        hint(ctx, "open your mouth to flap — don't hit the pipes!");
      },
    };
  }

  // 🎨 COLOR HUNT — show your camera something of the named color first
  function colorHuntMode() {
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
  function noteMode() {
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
  function screamMode() {
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
  function typingMode() {
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
  function tapMode() {
    let dots = [], score = 0, their = 0, t = 0, sp = 0, lastTap = 0, phase = "idle";
    return {
      enter() { dots = []; score = 0; their = 0; phase = "idle"; },
      action(a) { if (a === "go") { phase = "race"; t = 20; score = 0; dots = []; } },
      onNet(m) { if (m.t === "tap") their = m.s; },
      update(dt) {
        if (phase !== "race") return; t -= dt; sp -= dt;
        if (sp <= 0) { sp = 0.8; dots.push({ x: rnd(.12, .88), y: rnd(.12, .88), life: 2.2 }); }
        for (const d of dots) d.life -= dt; dots = dots.filter((d) => d.life > 0);
        if (host.pointer.t > lastTap) { lastTap = host.pointer.t; const lo = mySide * MID, hi = lo + MID; if (host.pointer.x >= lo && host.pointer.x <= hi) { for (let i = dots.length - 1; i >= 0; i--) { const p = toCanvas(dots[i], mySide); if (Math.hypot(p.x - host.pointer.x, p.y - host.pointer.y) < 40) { dots.splice(i, 1); score++; FX.sparkleAt(host.pointer.x, host.pointer.y, 6); FX.Sound.pop(); net.send({ t: "tap", s: score }); break; } } } }
        if (t <= 0) phase = "done";
      },
      draw(ctx) {
        for (const d of dots) { const p = toCanvas(d, mySide); ctx.save(); ctx.globalAlpha = Math.min(1, d.life); ctx.fillStyle = "#ffd24b"; ctx.beginPath(); ctx.arc(p.x, p.y, 34, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.stroke(); ctx.restore(); }
        scoreboard(ctx, [meIdx() === 0 ? score : their, meIdx() === 0 ? their : score], phase === "race" ? t : null, "Tap Attack 🎯");
        if (phase === "idle") big(ctx, "🎯 Tap Attack", "press “go” — tap the dots on your side!");
        else if (phase === "done") big(ctx, score > their ? "You win! 🎯" : score < their ? "Partner wins" : "tie!", "");
      },
    };
  }

  // 🕳️ HOLE IN THE WALL — pose your body to fit the hole (silhouette segmentation)
  function holeWallMode() {
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
        const S = mySide, gw = host.seg.gw, gh = host.seg.gh, fn = SHAPES[si][1];
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

  // 💓 LOVE TAP — buzz your partner's phone
  function loveTapMode() {
    return {
      action(a) { if (a === "tap") { try { navigator.vibrate && navigator.vibrate([90, 50, 90]); } catch (_) {} net.send({ t: "buzz" }); FX.flood(0, W, ["💓", "💗"], 16); FX.Sound.pop(); } },
      draw(ctx) { big(ctx, "💓 Love Tap", "press send — buzz your partner's phone 📳"); },
    };
  }

  // ---- shared UI helpers (consistent contrast, panels & alignment) --------
  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function pill(ctx, txt, x, y, size) {          // dark rounded chip behind text
    ctx.font = `${size}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(txt).width + size * 1.6;
    ctx.fillStyle = "rgba(8,10,16,.55)"; roundRect(ctx, x - w / 2, y - size, w, size * 2, size); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.fillText(txt, x, y);
  }
  function outline(ctx, t, x, y, size) {         // bold white text w/ dark outline
    ctx.font = `bold ${size}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, size * 0.15); ctx.strokeStyle = "rgba(0,0,0,.78)"; ctx.strokeText(t, x, y);
    ctx.fillStyle = "#fff"; ctx.fillText(t, x, y);
  }
  function fit(ctx, t, max, size, bold) { ctx.font = `${bold ? "bold " : ""}${size}px system-ui`; while (size > 14 && ctx.measureText(t).width > max) { size -= 2; ctx.font = `${bold ? "bold " : ""}${size}px system-ui`; } return size; }
  function hint(ctx, txt) { ctx.save(); pill(ctx, txt, W / 2, H - 30, 15); ctx.restore(); }
  function scoreboard(ctx, score, time, title) {
    ctx.save();
    pill(ctx, title + (time != null ? `  •  ${Math.max(0, Math.ceil(time))}s` : ""), W / 2, 30, 15);
    outline(ctx, `${score[0]}`, W * 0.25, 84, 46); outline(ctx, `${score[1]}`, W * 0.75, 84, 46);
    ctx.font = "14px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(255,255,255,.8)";
    const mine = meIdx();
    ctx.fillText(mine === 0 ? "you" : "partner", W * 0.25, 120); ctx.fillText(mine === 0 ? "partner" : "you", W * 0.75, 120);
    ctx.restore();
  }
  function big(ctx, line1, line2) {
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const maxW = W * 0.86;
    const s1 = fit(ctx, line1 || "", maxW, 50, true), s2 = line2 ? fit(ctx, line2, maxW, 24, false) : 0;
    ctx.font = `bold ${s1}px system-ui`; const w1 = ctx.measureText(line1 || "").width;
    ctx.font = `${s2}px system-ui`; const w2 = line2 ? ctx.measureText(line2).width : 0;
    const pw = Math.min(W * 0.95, Math.max(w1, w2) + 60), ph = (line2 ? s1 + s2 + 44 : s1 + 40), cx = W / 2, cy = H * 0.46;
    ctx.fillStyle = "rgba(8,10,16,.55)"; roundRect(ctx, cx - pw / 2, cy - ph / 2, pw, ph, 22); ctx.fill();
    outline(ctx, line1 || "", cx, cy - (line2 ? s2 * 0.7 : 0), s1);
    if (line2) { ctx.font = `${s2}px system-ui`; ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(line2, cx, cy + s1 * 0.5); }
    ctx.restore();
  }

  const factories = { share: createShareMode(net, () => authority ? 0 : 1), toys: toysMode, draw: drawMode, stamp: stampMode, catch: catchMode, pop: popMode, hockey: hockeyMode, rps: rpsMode, dontlaugh: dontLaughMode, mirror: mirrorMode, photobooth: photoboothMode, synctest: syncTestMode, thumbwar: thumbWarMode, spinner: spinnerMode,
    dressup: dressUpMode, slowdance: slowDanceMode, truthdare: truthDareMode, eightball: eightBallMode, tictactoe: ticTacToeMode,
    mashup: mashupMode, countdown: countdownMode, pictionary: pictionaryMode, breathing: breathingMode, karaoke: karaokeMode, kisscam: kissCamMode, mood: moodMode, pickup: pickupMode,
    oursong: ourSongMode, mailbox: mailboxMode, stars: starsMode, dancebattle: danceBattleMode, lovecalc: loveCalcMode,
    scrapbook: scrapbookMode, bucket: bucketMode,
    loversdice: loversDiceMode, wyr: wyrMode, never: neverMode, dareroulette: dareRouletteMode,
    target: targetTrackMode, simon: simonMode, balloon: balloonMode, reaction: reactionMode,
    winkbattle: winkBattleMode, charades: charadesMode, freeze: freezeMode, rhythm: rhythmMode, wish: wishMode, handsup: handsUpMode,
    q36: q36Mode, deeptalk: deepTalkMode, twentyq: twentyQMode, twotruths: twoTruthsMode, story: storyMode, telepathy: telepathyMode,
    vault: vaultMode, connect4: connect4Mode, memory: memoryMode, trivia: triviaMode, howwell: howWellMode, whomore: whoMoreMode, thisorthat: thisOrThatMode, hangman: hangmanMode,
    sayit: sayItMode, decipher: decipherMode, treasure: treasureMode, distance: distanceMode, tilt: tiltMode, shake: shakeMode,
    poseparty: poseMode, flappy: flappyMode, colorhunt: colorHuntMode, note: noteMode, scream: screamMode, typing: typingMode, tapattack: tapMode, lovetap: loveTapMode,
    holewall: holeWallMode };

  function setMode(name) {
    if (M && M.exit) M.exit();
    modeName = name;
    M = factories[name] ? factories[name]() : null;
    if (M && M.enter) M.enter();
  }
  return {
    setMode, setAuthority, setAdult,
    get mode() { return modeName; },
    update(dt, local, remote) { if (M && M.update) M.update(dt, local, remote); },
    draw(ctx) { if (M && M.draw) M.draw(ctx); },
    onNet(m) { if (M && M.onNet) M.onNet(m); },
    action(a) { if (M && M.action) M.action(a); },
  };
}
