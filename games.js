// games.js — stateful MODES: physics toys, draw, stamp, and mini-games.
// Free-play passive effects live in app.js. Each mode is a small object with
// enter/exit/update(dt,local,remote)/draw(ctx)/onNet(msg)/action(a).
// `net.send(obj)` broadcasts to the partner; app routes non-gesture msgs to onNet.

import * as FX from "./effects.js";
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

export function createGames(net) {
  let M = null, modeName = "free", authority = true;
  const setAuthority = (b) => { authority = b; };

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
  function catchMode() {
    let items = [], score = [0, 0], spawnT = 0, time = 30;
    const CH = ["❤️", "🍓", "🍰", "⭐", "🍩"];
    return {
      enter() { items = []; score = [0, 0]; time = 30; spawnT = 0; },
      update(dt, local, remote) {
        time -= dt; spawnT -= dt;
        if (spawnT <= 0 && time > 0) { spawnT = 0.6; items.push({ x: rnd(40, W - 40), y: -30, vy: rnd(150, 260), ch: pick(CH) }); }
        const hands = [cursorPx(local, 0), cursorPx(remote, 1)];
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i]; it.y += it.vy * dt;
          for (let s = 0; s < 2; s++) { const h = hands[s]; if (h && Math.hypot(h.x - it.x, h.y - it.y) < 60) { score[s]++; FX.sparkleAt(it.x, it.y, 6); FX.Sound.pop(); items.splice(i, 1); break; } }
          if (it && it.y > H + 40) items.splice(i, 1);
        }
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (const it of items) { ctx.font = "40px serif"; ctx.fillText(it.ch, it.x, it.y); }
        scoreboard(ctx, score, time, "Catch");
      },
    };
  }

  // ---------------- POP (bubbles rise, pop with a pointing finger) ---------
  function popMode() {
    let bubbles = [], score = [0, 0], spawnT = 0;
    return {
      enter() { bubbles = []; score = [0, 0]; },
      update(dt, local, remote) {
        spawnT -= dt; if (spawnT <= 0) { spawnT = 0.5; bubbles.push({ x: rnd(40, W - 40), y: H + 30, vy: rnd(60, 130), r: rnd(26, 46), hue: rnd(0, 360) }); }
        const tips = [pointPx(local, 0), pointPx(remote, 1)];
        for (let i = bubbles.length - 1; i >= 0; i--) {
          const b = bubbles[i]; b.y -= b.vy * dt; b.x += Math.sin(b.y / 40) * 0.6;
          for (let s = 0; s < 2; s++) { const t = tips[s]; if (t && Math.hypot(t.x - b.x, t.y - b.y) < b.r) { score[s]++; FX.burst(b.x, b.y, ["💧", "✨"], 6, 200); FX.Sound.pop(); bubbles.splice(i, 1); break; } }
          if (b && b.y < -40) bubbles.splice(i, 1);
        }
      },
      draw(ctx) {
        for (const b of bubbles) { ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = `hsl(${b.hue},80%,70%)`; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); ctx.globalAlpha = 0.9; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
        scoreboard(ctx, score, null, "Pop — point to pop");
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
    let loser = "", t = 0;
    return {
      enter() { loser = ""; t = 0; },
      update(dt, local, remote) {
        if (loser) { t -= dt; return; }
        const ll = local && local.face && (local.face.laugh || local.face.smile > 0.55);
        const rl = remote && remote.face && (remote.face.laugh || remote.face.smile > 0.55);
        if (ll) { loser = "You laughed! 😂"; FX.burst(W / 4, H / 2, ["😂"], 16); FX.addShake(0.4); t = 4; }
        else if (rl) { loser = "Partner laughed! 😂"; FX.burst(3 * W / 4, H / 2, ["😂"], 16); t = 4; }
      },
      draw(ctx) {
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        if (loser) {
          big(ctx, loser, "");
          // clown filter over the loser's half
          const side = loser.startsWith("You") ? 0 : 1;
          ctx.save(); ctx.globalAlpha = 0.9; ctx.font = "200px serif"; ctx.textBaseline = "middle";
          ctx.fillText("🤡", side * MID + MID / 2, H / 2); ctx.restore();
        } else big(ctx, "Don't Laugh 😐", "first to smile loses → 🤡");
      },
    };
  }

  // ---------------- MIRROR ME ----------------------------------------------
  function mirrorMode() {
    const POSES = [["✊ fist", "fist"], ["✋ palm", "palm"], ["✌️ peace", "peace"], ["👍 thumbs up", "thumbsUp"], ["🤟 rock", "rockOn"], ["👉 point", "point"]];
    let target = POSES[0], t = 4, score = 0;
    const next = () => { target = pick(POSES); t = 4; };
    return {
      enter() { score = 0; next(); },
      update(dt, local) { t -= dt; if (local && local.poses && local.poses[target[1]]) { score++; FX.sparkleAt(W / 4, H / 2, 10); FX.Sound.chime(); next(); } else if (t <= 0) next(); },
      draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "Make: " + target[0], `score ${score} • ${Math.ceil(t)}s`); },
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

  const factories = { toys: toysMode, draw: drawMode, stamp: stampMode, catch: catchMode, pop: popMode, hockey: hockeyMode, rps: rpsMode, dontlaugh: dontLaughMode, mirror: mirrorMode };

  function setMode(name) {
    if (M && M.exit) M.exit();
    modeName = name;
    M = factories[name] ? factories[name]() : null;
    if (M && M.enter) M.enter();
  }
  return {
    setMode, setAuthority,
    get mode() { return modeName; },
    update(dt, local, remote) { if (M && M.update) M.update(dt, local, remote); },
    draw(ctx) { if (M && M.draw) M.draw(ctx); },
    onNet(m) { if (M && M.onNet) M.onNet(m); },
    action(a) { if (M && M.action) M.action(a); },
  };
}
