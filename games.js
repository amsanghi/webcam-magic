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
      action(act) {
        if (act !== "go") return;
        if (!a || !b) { const v = prompt("Your two names (comma separated):", ""); if (v) { const p = v.split(","); a = (p[0] || "").trim(); b = (p[1] || "").trim(); } }
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
      action(a) { if (a === "set") { const v = prompt("Date you'll next meet (YYYY-MM-DD):", get() || ""); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) try { localStorage.setItem("wm_meet", v.trim()); } catch (_) {} } },
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
      action(a) {
        if (a === "word") { isDrawer = true; word = pick(WORDS); revealed = false; strokes = []; net.send({ t: "pic-role" }); net.send({ t: "draw-clear" }); }
        else if (a === "reveal") { revealed = true; net.send({ t: "pic-reveal", w: word }); }
        else if (a === "clear") { strokes = []; net.send({ t: "draw-clear" }); }
        else if (a === "guess") { if (isDrawer) return; const g = prompt("Your guess:"); if (g) net.send({ t: "pic-guess", g }); }
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
      action(a) { if (a === "lyrics") { const v = prompt("Paste lyrics (one line per line):"); if (v) { lines = v.split("\n"); y = H; net.send({ t: "lyrics", text: v }); } } else if (a === "restart") y = H; },
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
      action(a) { if (a === "set") { const v = prompt("Name your song:", title); if (v) { title = v; net.send({ t: "song", title: v }); } } },
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
      action(a) { if (a === "write") { const v = prompt("Write a love note for your partner:"); if (v) { net.send({ t: "letter", text: v }); FX.travel({ x: W * 0.25, y: H * 0.5 }, () => ({ x: W, y: H * 0.4 }), "💌"); FX.banner(W / 2, H * 0.3, "sent 💌"); FX.Sound.chime(); } } },
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
      action(a) { if (a === "calc") { const v = prompt("Two names (comma separated):", ""); if (v) { let h = 0; for (const ch of v.toLowerCase().replace(/[^a-z]/g, "")) h = (h * 31 + ch.charCodeAt(0)) % 1000; pct = 75 + h % 26; verdict = pick(V); net.send({ t: "lovecalc", pct, verdict }); FX.flood(0, W, ["❤️", "💕"], 30); FX.Sound.chime(); } } },
      onNet(m) { if (m.t === "lovecalc") { pct = m.pct; verdict = m.verdict; } },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; pct == null ? big(ctx, "❤️ Love Calculator", "press “calc” + enter both names") : big(ctx, pct + "% 💘", verdict); },
    };
  }

  // ---------------- SCRAPBOOK (gallery of Photo Booth shots) ---------------
  function scrapbookMode() {
    let imgs = [], idx = 0;
    const load = () => { try { return JSON.parse(localStorage.getItem("wm_scrapbook") || "[]"); } catch (_) { return []; } };
    return {
      enter() { imgs = load().map((u) => { const i = new Image(); i.src = u; return i; }); idx = Math.max(0, imgs.length - 1); },
      action(a) { if (a === "prev") idx = Math.max(0, idx - 1); else if (a === "next") idx = Math.min(imgs.length - 1, idx + 1); else if (a === "clear") { try { localStorage.removeItem("wm_scrapbook"); } catch (_) {} imgs = []; idx = 0; } },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        if (!imgs.length) return big(ctx, "📔 Scrapbook", "take 📸 Photo Booth shots — they save here");
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
      action(a) { if (a === "add") { const v = prompt("Add something to do together:"); if (v) { items.push({ t: v, done: false }); save(); net.send({ t: "bucket", items }); } } else if (a === "clear") { items = []; save(); net.send({ t: "bucket", items }); } },
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
  function hint(ctx, txt) { ctx.save(); ctx.globalAlpha = 0.7; ctx.fillStyle = "#fff"; ctx.font = "15px system-ui"; ctx.textAlign = "center"; ctx.fillText(txt, W / 2, H - 24); ctx.restore(); }
  function scoreboard(ctx, score, time, title) {
    ctx.save(); ctx.fillStyle = "#fff"; ctx.font = "bold 30px system-ui"; ctx.textAlign = "center";
    ctx.fillText(`${score[0]}`, W / 4, 56); ctx.fillText(`${score[1]}`, 3 * W / 4, 56);
    ctx.font = "16px system-ui"; ctx.globalAlpha = .8; ctx.fillText(title + (time != null ? `  •  ${Math.max(0, Math.ceil(time))}s` : ""), W / 2, 40);
    ctx.restore();
  }
  function big(ctx, line1, line2) { ctx.save(); ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 14; ctx.font = "bold 56px system-ui"; ctx.fillText(line1, W / 2, H / 2); ctx.font = "22px system-ui"; ctx.globalAlpha = .85; ctx.fillText(line2, W / 2, H / 2 + 50); ctx.restore(); }

  const factories = { share: createShareMode(net, () => authority ? 0 : 1), toys: toysMode, draw: drawMode, stamp: stampMode, catch: catchMode, pop: popMode, hockey: hockeyMode, rps: rpsMode, dontlaugh: dontLaughMode, mirror: mirrorMode, photobooth: photoboothMode, synctest: syncTestMode, thumbwar: thumbWarMode, spinner: spinnerMode,
    dressup: dressUpMode, slowdance: slowDanceMode, truthdare: truthDareMode, eightball: eightBallMode, tictactoe: ticTacToeMode,
    mashup: mashupMode, countdown: countdownMode, pictionary: pictionaryMode, breathing: breathingMode, karaoke: karaokeMode, kisscam: kissCamMode, mood: moodMode, pickup: pickupMode,
    oursong: ourSongMode, mailbox: mailboxMode, stars: starsMode, dancebattle: danceBattleMode, lovecalc: loveCalcMode,
    scrapbook: scrapbookMode, bucket: bucketMode,
    loversdice: loversDiceMode, wyr: wyrMode, never: neverMode, dareroulette: dareRouletteMode };

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
