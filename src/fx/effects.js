// effects.js — particle engine, screen overlays, and WebAudio sounds.
// All spawner coordinates are CANVAS pixels. Canvas is 1280x720, seam at MID.

export const W = 1280, H = 720, MID = 640;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
export { rnd, pick };

function rr(ctx, x, y, w, h, r) {           // rounded-rect path (canvas-native w/ fallback)
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------------------------------------------------------------------------
// PARTICLES
// ---------------------------------------------------------------------------
const particles = [];
const MAX_P = 1800;

// The common *decorative* emoji get rendered as crisp glowing vector shapes
// instead of OS emoji glyphs (looks far more modern). Expressive emoji (faces,
// hands, objects) still render as emoji — they carry meaning. This is keyed off
// the char so every existing spawner is upgraded with no call-site changes.
const HEART_COLORS = { "❤️": "#ff4d6d", "💖": "#ff6ea8", "💕": "#ff86b8", "💗": "#ff9ec9", "💞": "#ff6ea8", "💓": "#ff5a7a", "🩷": "#ffa6cf", "💛": "#ffd85e", "🧡": "#ff9f45", "💜": "#b98cff", "💙": "#6aa8ff", "💚": "#5ad07a", "🤍": "#ffe6ef" };
const CONFETTI_COLORS = { "🟥": "#ff5a5a", "🟦": "#5aa0ff", "🟨": "#ffd24b", "🟩": "#5ad07a", "🟪": "#b06bff", "🟧": "#ff9f45", "🟫": "#c08457" };
const SPARK_SET = new Set(["✨", "⭐", "💫", "🌟", "✦", "⭐️"]);

export function emoji(x, y, vx, vy, ch, size, life, g = 600, opts = {}) {
  if (particles.length >= MAX_P) return;
  const p = {
    x, y, vx, vy, ch, size, life, max: life, g,
    rot: opts.rot ?? rnd(-0.5, 0.5), vr: opts.vr ?? rnd(-3, 3),
    spin: opts.spin || false, stick: opts.stick || null, pop: opts.pop !== false,
  };
  const hc = HEART_COLORS[ch], cc = CONFETTI_COLORS[ch];
  if (hc) { p.kind = "heart"; p.color = hc; }
  else if (SPARK_SET.has(ch)) { p.kind = "spark"; }
  else if (cc) { p.kind = "confetti"; p.color = cc; }
  particles.push(p);
}

// vector shapes centred at (0,0), sized by s
function heartShape(ctx, s) {
  const u = s / 32;
  ctx.beginPath();
  ctx.moveTo(0, 10 * u);
  ctx.bezierCurveTo(-14 * u, -4 * u, -10 * u, -16 * u, 0, -8 * u);
  ctx.bezierCurveTo(10 * u, -16 * u, 14 * u, -4 * u, 0, 10 * u);
  ctx.closePath();
}
function sparkShape(ctx, s) {
  const a = s * 0.58, b = s * 0.13;
  ctx.beginPath();
  ctx.moveTo(0, -a); ctx.quadraticCurveTo(b, -b, a, 0); ctx.quadraticCurveTo(b, b, 0, a);
  ctx.quadraticCurveTo(-b, b, -a, 0); ctx.quadraticCurveTo(-b, -b, 0, -a); ctx.closePath();
}
export function flood(x0, x1, chars, n, big = false) {
  for (let i = 0; i < n; i++)
    emoji(rnd(x0, x1), H + rnd(0, 140), rnd(-40, 40), rnd(-560, -360),
          pick(chars), big ? rnd(46, 82) : rnd(26, 46), rnd(2.4, 4), 130);
}
export function burst(x, y, chars, n, spd = 380) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), s = rnd(spd * 0.4, spd);
    emoji(x, y, Math.cos(a) * s, Math.sin(a) * s, pick(chars), rnd(28, 48), rnd(1, 2), 480);
  }
}
export function spray(x, y, dir, chars, n) {
  for (let i = 0; i < n; i++)
    emoji(x, y, dir * rnd(260, 560), rnd(-240, 60), pick(chars), rnd(30, 52), rnd(1.6, 2.8), 140);
}
export function fountain(x, y, chars, n, spd = 520) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + rnd(-0.5, 0.5);
    emoji(x, y, Math.cos(a) * rnd(spd * 0.4, spd), Math.sin(a) * rnd(spd * 0.6, spd),
          pick(chars), rnd(26, 44), rnd(1.4, 2.4), 560);
  }
}
export function sparkleAt(x, y, n = 1) {
  const b = 1 + 0.7 * beatVal;                            // beat-reactive size
  for (let i = 0; i < n; i++)
    emoji(x + rnd(-46, 46), y + rnd(-46, 46), rnd(-30, 30), rnd(-70, 30),
          pick(["✨", "⭐", "💫", "🌟"]), rnd(15, 30) * b, rnd(0.7, 1.5), 200);
}
// rising balloons + a "LOL" tag (laugh)
export function balloons(x, n = 6) {
  for (let i = 0; i < n; i++)
    emoji(x + rnd(-120, 120), H + rnd(0, 80), rnd(-30, 30), -rnd(150, 260),
          pick(["🎈", "🎈", "🎈"]), rnd(34, 52), rnd(2.4, 3.6), -120, { vr: 0 });
  emoji(x + rnd(-60, 60), H * 0.7, 0, -200, "LOL", 52, 2.2, -40, { vr: 0 });
}
export function confetti(x, y, n = 18) {
  for (let i = 0; i < n; i++) {
    const a = rnd(-Math.PI, 0), s = rnd(260, 560);
    emoji(x, y, Math.cos(a) * s, Math.sin(a) * s,
          pick(["🎉", "🎊", "🟥", "🟦", "🟨", "🟩", "🟪"]), rnd(16, 30), rnd(1.2, 2.2), 620, { spin: true });
  }
}
export function plusOne(x, y, ch = "👍") { emoji(x, y, 0, -300, ch, 76, 2, 70, { vr: 0 }); }

export function stepParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p.stick && p.stick()) { const s = p.stick(); p.x = s.x; p.y = s.y; }
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    if (!p.stick) {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
  }
}
export function drawParticles(ctx) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const p of particles) {
    const t = p.life / p.max;
    const grow = p.pop ? Math.min(1, (1 - t) * 6) : 1;
    const sz = p.size * (0.7 + 0.3 * grow);
    ctx.save();
    ctx.globalAlpha = t < 0.14 ? t / 0.14 : 1;          // full opacity until the last sliver of life
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    if (p.kind === "heart") {
      ctx.shadowColor = p.color; ctx.shadowBlur = sz * 0.4;
      ctx.fillStyle = p.color; heartShape(ctx, sz); ctx.fill();
    } else if (p.kind === "spark") {
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "#ffe6a0"; ctx.shadowBlur = sz * 0.55;
      ctx.fillStyle = "#fff4c8"; sparkShape(ctx, sz * 1.1); ctx.fill();
    } else if (p.kind === "confetti") {
      ctx.fillStyle = p.color;
      const w = sz * 0.72, h = sz * 0.34;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.45); ctx.fill(); }
      else ctx.fillRect(-w / 2, -h / 2, w, h);
    } else {
      ctx.font = `${sz}px serif`;
      ctx.lineJoin = "round"; ctx.lineWidth = Math.max(3, sz * 0.12);   // dark outline so it pops on any background
      ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.strokeText(p.ch, 0, 0);
      ctx.fillText(p.ch, 0, 0);
    }
    ctx.restore();
  }
  drawTravel(ctx);
}
export function clearParticles() { particles.length = 0; }
export const particleCount = () => particles.length;

// ---------------------------------------------------------------------------
// SCREEN STATE (held, eased) — vignette, tint, spotlight, fog, rainbow
// ---------------------------------------------------------------------------
const ease = (cur, tgt, k) => cur + (tgt - cur) * k;
const screen = {
  vig: [0, 0], vigT: [0, 0],
  tint: { r: 255, g: 120, b: 160, a: 0, aT: 0 },
  spot: [null, null],            // {x,y} per side, or null
  fog: [0, 0], fogT: [0, 0], holes: [[], []],
  concert: [0, 0], concertT: [0, 0],
  shake: 0,
};
let rainbow = 0;                 // ttl seconds for the arc
let beatVal = 0;                 // 0..1 audio energy (beat-reactive)
let concertPhase = 0;
export function setBeat(v) { beatVal = Math.max(0, Math.min(1, v)); }
export function getBeat() { return beatVal; }
export function setConcert(side, on) { screen.concertT[side] = on ? 1 : 0; }

export function setVignette(side, on) { screen.vigT[side] = on ? 1 : 0; }
export function setSpotlight(side, pt) { screen.spot[side] = pt; }
export function setTint(r, g, b, a) { screen.tint.r = r; screen.tint.g = g; screen.tint.b = b; screen.tint.aT = a; }
export function setFog(side, on) { screen.fogT[side] = on ? 1 : 0; if (!on && screen.fog[side] < 0.02) screen.holes[side] = []; }
export function wipeFog(side, x, y) { screen.holes[side].push({ x, y, r: 70, t: 1 }); }
export function triggerRainbow() { rainbow = 3.2; }
export function addShake(a) { screen.shake = Math.max(screen.shake, a); }
export function getShake() {
  if (screen.shake < 0.01) return { x: 0, y: 0 };
  return { x: rnd(-1, 1) * 18 * screen.shake, y: rnd(-1, 1) * 18 * screen.shake };
}

export function stepScreen(dt) {
  for (let s = 0; s < 2; s++) {
    screen.vig[s] = ease(screen.vig[s], screen.vigT[s], 0.15);
    screen.fog[s] = ease(screen.fog[s], screen.fogT[s], 0.08);
    screen.concert[s] = ease(screen.concert[s], screen.concertT[s], 0.2);
    for (const h of screen.holes[s]) { h.r = Math.min(140, h.r + 220 * dt); h.t -= dt * 0.12; }
    screen.holes[s] = screen.holes[s].filter((h) => h.t > 0);
  }
  screen.tint.a = ease(screen.tint.a, screen.tint.aT, 0.05);
  screen.shake *= 0.86;
  if (rainbow > 0) rainbow -= dt;
  concertPhase += dt * (6 + beatVal * 14);
  stepWeather(dt); stepTravel(dt);
}

export function drawScreen(ctx) {
  drawWeather(ctx);
  // mood tint (whole frame)
  if (screen.tint.a > 0.01) {
    ctx.save(); ctx.globalAlpha = screen.tint.a;
    ctx.fillStyle = `rgb(${screen.tint.r|0},${screen.tint.g|0},${screen.tint.b|0})`;
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  // per-side vignette
  for (let s = 0; s < 2; s++) {
    if (screen.vig[s] > 0.01) {
      const cx = s * MID + MID / 2, cy = H / 2;
      const g = ctx.createRadialGradient(cx, cy, H * 0.18, cx, cy, H * 0.62);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${0.8 * screen.vig[s]})`);
      ctx.save(); ctx.beginPath(); ctx.rect(s * MID, 0, MID, H); ctx.clip();
      ctx.fillStyle = g; ctx.fillRect(s * MID, 0, MID, H); ctx.restore();
    }
    // spotlight: darken everything except a soft circle at pt
    const sp = screen.spot[s];
    if (sp) {
      const c = { x: s * MID + sp.x * MID, y: sp.y * H };
      const g = ctx.createRadialGradient(c.x, c.y, 30, c.x, c.y, 220);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.72)");
      ctx.save(); ctx.beginPath(); ctx.rect(s * MID, 0, MID, H); ctx.clip();
      ctx.fillStyle = g; ctx.fillRect(s * MID, 0, MID, H); ctx.restore();
    }
    // concert mode: colored light bands sweeping the half (rock-on)
    if (screen.concert[s] > 0.01) {
      const cols = ["#ff3b6b", "#3bd1ff", "#ffe23b", "#9b6bff"];
      ctx.save(); ctx.beginPath(); ctx.rect(s * MID, 0, MID, H); ctx.clip();
      ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.4 * screen.concert[s];
      cols.forEach((c, i) => {
        const x = s * MID + MID / 2 + Math.sin(concertPhase + i * 1.7) * MID * 0.4;
        const g = ctx.createRadialGradient(x, H * 0.2, 0, x, H * 0.2, 260);
        g.addColorStop(0, c); g.addColorStop(1, "transparent");
        ctx.fillStyle = g; ctx.fillRect(s * MID, 0, MID, H);
      });
      ctx.restore();
    }
    // fog with wipe holes
    if (screen.fog[s] > 0.01) {
      ctx.save(); ctx.beginPath(); ctx.rect(s * MID, 0, MID, H); ctx.clip();
      ctx.globalAlpha = 0.85 * screen.fog[s];
      ctx.fillStyle = "#cdd6e6"; ctx.fillRect(s * MID, 0, MID, H);
      ctx.globalCompositeOperation = "destination-out";
      for (const h of screen.holes[s]) {
        const c = { x: s * MID + h.x * MID, y: h.y * H };
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, h.r);
        g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, h.r, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
  }
  // rainbow arc across both feeds
  if (rainbow > 0) {
    const a = Math.min(1, rainbow) * 0.6;
    const cols = ["#ff5b5b", "#ffa24b", "#ffe24b", "#5bd96b", "#4bb6ff", "#9b6bff"];
    ctx.save(); ctx.globalAlpha = a; ctx.lineWidth = 16; ctx.lineCap = "round";
    cols.forEach((c, i) => {
      ctx.strokeStyle = c; ctx.beginPath();
      ctx.arc(W / 2, H + 120, 360 + i * 18, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    });
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// REACTION WEATHER (section 8): drifting background motes set by collective mood
// ---------------------------------------------------------------------------
const weather = { type: "none", inten: 0, motes: [] };
export function setWeather(type, inten) { weather.type = type; weather.inten = inten; }
function stepWeather(dt) {
  const want = weather.type === "none" ? 0 : Math.round(weather.inten * 60);
  while (weather.motes.length < want) weather.motes.push({ x: rnd(0, W), y: rnd(0, H), v: rnd(20, 70), p: rnd(0, 6) });
  while (weather.motes.length > want) weather.motes.pop();
  for (const m of weather.motes) {
    if (weather.type === "rain") { m.y += (m.v + 180) * dt; if (m.y > H) { m.y = -10; m.x = rnd(0, W); } }
    else { m.y -= m.v * dt * 0.4; m.x += Math.sin((m.p += dt)) * 12 * dt; if (m.y < -10) { m.y = H + 10; m.x = rnd(0, W); } }
  }
}
function drawWeather(ctx) {
  if (weather.type === "none" || !weather.motes.length) return;
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const ch = weather.type === "rain" ? "💧" : weather.type === "stars" ? "·" : "✨";
  ctx.globalAlpha = 0.35 * weather.inten;
  for (const m of weather.motes) {
    if (weather.type === "stars") { ctx.fillStyle = "#fff"; ctx.font = "14px serif"; ctx.fillText("✦", m.x, m.y); }
    else { ctx.font = "16px serif"; ctx.fillText(ch, m.x, m.y); }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HOMING TRAVELERS (section 4): a kiss that flies across to the partner's face
// ---------------------------------------------------------------------------
const travelers = [];
export function travel(from, toFn, ch, onArrive) { travelers.push({ x: from.x, y: from.y, toFn, ch, onArrive, t: 0, dur: 0.9 }); }
function stepTravel(dt) {
  for (let i = travelers.length - 1; i >= 0; i--) {
    const tr = travelers[i]; tr.t += dt / tr.dur;
    const dst = tr.toFn(); if (!dst) { travelers.splice(i, 1); continue; }
    const k = tr.t < 1 ? 1 - Math.pow(1 - tr.t, 3) : 1;
    tr.x += (dst.x - tr.x) * Math.min(1, k * 0.25 + 0.05);
    tr.y += (dst.y - tr.y) * Math.min(1, k * 0.25 + 0.05) - 30 * dt * (1 - tr.t);
    if (tr.t >= 1) { if (tr.onArrive) tr.onArrive(dst); travelers.splice(i, 1); }
  }
}
function drawTravel(ctx) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "44px serif"; ctx.lineJoin = "round"; ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,.7)";
  for (const tr of travelers) { ctx.strokeText(tr.ch, tr.x, tr.y); ctx.fillText(tr.ch, tr.x, tr.y); }
}

// ---------------------------------------------------------------------------
// TRANSIENT OVERLAYS (flash, links, banners, custom draws with ttl)
// ---------------------------------------------------------------------------
const overlays = [];
export function flash() { overlays.push({ ttl: 0.45, age: 0, kind: "flash" }); }
export function link(ax, ay, bx, by) { overlays.push({ ttl: 0.1, age: 0, kind: "link", ax, ay, bx, by }); }
export function ring(x, y, color) { overlays.push({ ttl: 0.6, age: 0, kind: "ring", x, y, color }); }
export function banner(x, y, text) { overlays.push({ ttl: 1.4, age: 0, kind: "banner", x, y, text }); }

// 📱 stacked view (portrait phones): the two halves are re-composited vertically
// at display time. Screen-centered text would tear across the seam, so banner()
// (and stack-aware modes via isStacked) render once per half instead.
let stackedView = false;
export function setStacked(b) { stackedView = !!b; }
export const isStacked = () => stackedView;
export function blush(x, y) { overlays.push({ ttl: 1.2, age: 0, kind: "blush", x, y }); }

export function stepOverlays(dt) {
  for (let i = overlays.length - 1; i >= 0; i--) {
    overlays[i].age += dt;
    if (overlays[i].age >= overlays[i].ttl) overlays.splice(i, 1);
  }
}
export function drawOverlays(ctx) {
  for (const o of overlays) {
    const k = o.age / o.ttl;
    if (o.kind === "flash") {
      ctx.save(); ctx.globalAlpha = (1 - k) * 0.9; ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H); ctx.restore();
    } else if (o.kind === "link") {
      ctx.save(); ctx.globalAlpha = 0.9; ctx.strokeStyle = "#ff7aa8"; ctx.lineWidth = 6;
      ctx.shadowColor = "#ff7aa8"; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.moveTo(o.ax, o.ay);
      ctx.quadraticCurveTo((o.ax + o.bx) / 2, Math.min(o.ay, o.by) - 60, o.bx, o.by);
      ctx.stroke(); ctx.restore();
    } else if (o.kind === "ring") {
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = o.color || "#fff";
      ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(o.x, o.y, 20 + k * 90, 0, 7); ctx.stroke();
      ctx.restore();
    } else if (o.kind === "banner") {
      // stacked: a seam-centered banner is drawn once per half (smaller) so
      // both stacked panels read it whole instead of getting torn pieces.
      const spots = stackedView && Math.abs(o.x - W / 2) < 220 ? [[W * 0.25, 0.78], [W * 0.75, 0.78]] : [[o.x, 1]];
      for (const [bx, sc] of spots) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - k) * 2);
        ctx.translate(bx, o.y - k * 40); ctx.scale(sc, sc);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const size = 42; ctx.font = `700 ${size}px system-ui`;
        const w = ctx.measureText(o.text).width + size * 1.5, h = size * 1.72;
        ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
        ctx.fillStyle = "rgba(10,12,20,0.66)"; rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 1.5; rr(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.fillText(o.text, 0, 0);
        ctx.restore();
      }
    } else if (o.kind === "blush") {
      ctx.save(); ctx.globalAlpha = (1 - k) * 0.6; ctx.fillStyle = "#ff7aa8";
      for (const dx of [-26, 26]) { ctx.beginPath(); ctx.arc(o.x + dx, o.y + 6, 16, 0, 7); ctx.fill(); }
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// SOUND (WebAudio, no assets)
// ---------------------------------------------------------------------------
let actx = null;
const audio = () => (actx = actx || new (window.AudioContext || window.webkitAudioContext)());
function tone(f, t0, dur, type = "sine", vol = 0.15, slideTo = null) {
  const a = audio(), o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  o.connect(g); g.connect(a.destination);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(t0, dur, vol = 0.2, hp = 800) {
  const a = audio(), n = a.createBufferSource();
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  n.buffer = buf;
  const f = a.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
  const g = a.createGain(); g.gain.value = vol;
  n.connect(f); f.connect(g); g.connect(a.destination);
  n.start(t0); n.stop(t0 + dur);
}
let lastSound = {};
function throttle(name, ms) { const t = performance.now(); if (t - (lastSound[name] || 0) < ms) return false; lastSound[name] = t; return true; }

export const Sound = {
  chime() { if (!throttle("chime", 600)) return; const a = audio(); [880, 1320, 1760].forEach((f, i) => tone(f, a.currentTime + i * 0.08, 0.5, "sine", 0.16)); },
  pop() { if (!throttle("pop", 60)) return; const a = audio(); tone(660, a.currentTime, 0.12, "triangle", 0.18, 990); },
  boo() { if (!throttle("boo", 500)) return; const a = audio(); tone(300, a.currentTime, 0.6, "sawtooth", 0.14, 120); },
  applause() { if (!throttle("clap", 400)) return; const a = audio(); for (let i = 0; i < 14; i++) noise(a.currentTime + i * 0.03, 0.06, 0.12, 1500); },
  raspberry() { if (!throttle("rasp", 500)) return; const a = audio(); tone(140, a.currentTime, 0.5, "sawtooth", 0.16, 90); },
  riff() { if (!throttle("riff", 700)) return; const a = audio(); [330, 392, 494, 660].forEach((f, i) => tone(f, a.currentTime + i * 0.09, 0.25, "square", 0.1)); },
  whoosh() { if (!throttle("whoosh", 200)) return; const a = audio(); noise(a.currentTime, 0.25, 0.12, 500); },
  sad() { if (!throttle("sad", 600)) return; const a = audio(); tone(440, a.currentTime, 0.5, "sine", 0.12, 220); },
  snap() { if (!throttle("snap", 200)) return; const a = audio(); noise(a.currentTime, 0.04, 0.25, 3000); },
  boing() { if (!throttle("boing", 250)) return; const a = audio(); tone(500, a.currentTime, 0.28, "sine", 0.18, 180); },
};

// Map a display-normalized point [0..1] within a half to canvas pixels.
// Both halves are selfie-mirrored (everyone sees a natural mirror of themselves),
// and display-norm x is already mirrored, so this uniform mapping lines effects
// up with the mirrored video on either side.
export function toCanvas(pt, side) {
  return { x: side * MID + pt.x * MID, y: pt.y * H };
}
