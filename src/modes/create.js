// create.js — Create modes: toys, draw, stamp, stars, our song, scrapbook.
import { FX, net, host, authority, meIdx, W, H, MID, toCanvas, rnd, pick, clamp, cursor, cursorPx, activeCur, roundRect, pill, outline, fit, hint, scoreboard, big } from "./_shared.js";

// ---------------- TOYS (physics + grab + throw + gravity + magnet) -------
export function toysMode() {
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
export function drawMode() {
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
export function stampMode() {
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


// ---------------- OUR STARS (shared constellation) -----------------------
export function starsMode() {
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


// ---------------- OUR SONG (mic-reactive vinyl visualizer) ---------------
export function ourSongMode() {
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


// ---------------- SCRAPBOOK (gallery of Photo Booth shots) ---------------
export function scrapbookMode() {
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

export const modes = {
  "toys": { cat: "Create", ic: "🧸", nm: "Toys", how: ["Pinch to grab & throw objects", "Open palm = magnet", "Two hands: spread = resize, twist = rotate", "Shake your head to scatter • drop one on your nose to wear it"], actions: [["gravity", "gravity"], ["spawn", "+toy"], ["clear", "clear"]], make: toysMode },
  "draw": { cat: "Create", ic: "✏️", nm: "Draw", how: ["Pinch to paint together on a shared canvas", "Use “clear” to wipe it"], actions: [["clear", "clear"]], make: drawMode },
  "stamp": { cat: "Create", ic: "🏷️", nm: "Stamp", how: ["Pinch to drop a sticker", "“next” cycles the sticker"], actions: [["next", "next"], ["clear", "clear"]], make: stampMode },
  "stars": { cat: "Create", ic: "✨", nm: "Our Stars", how: ["Pinch to place a star on the night sky", "Together you draw a constellation"], actions: [["clear", "clear"]], make: starsMode },
  "oursong": { cat: "Create", ic: "🎶", nm: "Our Song", how: ["Name your song", "Play it out loud — the vinyl & bars dance to the beat"], actions: [["set", "🎶 name it"]], make: ourSongMode },
  "scrapbook": { cat: "Create", ic: "📔", nm: "Scrapbook", how: ["Close your eyes (or use Photo Booth) to snap moments — they save here", "◀ ▶ to flip • ⬇ save to download to your Photos"], actions: [["prev", "◀"], ["next", "▶"], ["save", "⬇ save"], ["all", "⬇ all"], ["clear", "🗑"]], make: scrapbookMode },
};
