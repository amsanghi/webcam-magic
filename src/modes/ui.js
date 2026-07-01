// ui.js — shared HUD helpers for modes.
//
// Big change (2026-07): the primary mode text (headline, subtitle, hint, and the
// scoreboard) is NO LONGER painted onto the video. Instead `big()`, `hint()` and
// `scoreboard()` write into a small HUD state object that app.js flushes to real
// DOM elements each frame — a caption card *below* the video and a score bar
// *above* it. This keeps the video clean and the text crisp/selectable.
//
// `pill()` and `outline()` still draw on the canvas: they're used for in-scene,
// position-anchored labels (timers, per-item tags) where being on the video is
// the point. `roundRect`/`fit` remain for modes that draw custom overlays.

import { W, H } from "../fx/effects.js";

// ---- DOM HUD state (read + reset by app.js each frame) --------------------
const HUD = { title: "", sub: "", hint: "", score: null };
let hudActive = false;
export function hudReset() { HUD.title = ""; HUD.sub = ""; HUD.hint = ""; HUD.score = null; hudActive = false; }
export function hudState() { return hudActive ? HUD : null; }

export function big(ctx, line1, line2) { HUD.title = line1 == null ? "" : String(line1); HUD.sub = line2 == null ? "" : String(line2); hudActive = true; }
export function hint(ctx, txt) { HUD.hint = txt == null ? "" : String(txt); hudActive = true; }
export function scoreboard(ctx, score, time, title) { HUD.score = { a: score[0], b: score[1], time: time == null ? null : time, title: title || "" }; hudActive = true; }

// ---- canvas helpers (still drawn on the feed) -----------------------------
export function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function pill(ctx, txt, x, y, size) {          // rounded chip behind in-scene text
  ctx.save();
  ctx.font = `500 ${size}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(txt).width + size * 1.7, h = size * 2.1;
  ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
  ctx.fillStyle = "rgba(10,12,20,0.72)"; roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1; roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fillText(txt, x, y);
  ctx.restore();
}
export function outline(ctx, t, x, y, size) {         // bold white text w/ soft dark outline
  ctx.save();
  ctx.font = `600 ${size}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
  ctx.lineWidth = Math.max(3, size * 0.16); ctx.strokeStyle = "rgba(0,0,0,0.72)"; ctx.strokeText(t, x, y);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#fff"; ctx.fillText(t, x, y);
  ctx.restore();
}
export function fit(ctx, t, max, size, bold) { ctx.font = `${bold ? "600 " : ""}${size}px system-ui`; while (size > 14 && ctx.measureText(t).width > max) { size -= 2; ctx.font = `${bold ? "600 " : ""}${size}px system-ui`; } return size; }
