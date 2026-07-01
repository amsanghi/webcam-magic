// ui.js — shared canvas text/box helpers used across modes for a readable HUD:
// rounded chips, soft-outlined text, a title/score board, and a big center
// caption card. All drawing is in the logical 1280x720 space (see fx/effects.js).
//
// Design goal: text drawn *over live video* must read as an intentional caption,
// not stamped-on glyphs. We lean on dark, softly-shadowed panels with a hairline
// border, real word-wrapping, and gentle text shadows for legibility on any feed.

import { W, H } from "../fx/effects.js";
import { meIdx } from "./context.js";

export function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// greedy word-wrap; assumes ctx.font is already set. Returns an array of lines.
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (!cur || ctx.measureText(test).width <= maxW) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// a modern translucent caption panel: soft drop shadow + hairline border.
function panel(ctx, cx, cy, w, h, r = 20) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12;
  ctx.fillStyle = "rgba(10,12,20,0.82)";
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, r); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1.5;
  roundRect(ctx, cx - w / 2, cy - h / 2, w, h, r); ctx.stroke();
  ctx.restore();
}

function softText(ctx, t, x, y) {           // gentle shadow, uses current font/fillStyle
  ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 1;
  ctx.fillText(t, x, y); ctx.restore();
}

export function pill(ctx, txt, x, y, size) {          // rounded chip behind text
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

export function hint(ctx, txt) { ctx.save(); pill(ctx, txt, W / 2, H - 34, 15); ctx.restore(); }

export function scoreboard(ctx, score, time, title) {
  ctx.save();
  pill(ctx, title + (time != null ? `  •  ${Math.max(0, Math.ceil(time))}s` : ""), W / 2, 32, 15);
  outline(ctx, `${score[0]}`, W * 0.25, 88, 46); outline(ctx, `${score[1]}`, W * 0.75, 88, 46);
  const mine = meIdx();
  ctx.font = "500 14px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(255,255,255,.82)";
  softText(ctx, mine === 0 ? "you" : "partner", W * 0.25, 124); softText(ctx, mine === 0 ? "partner" : "you", W * 0.75, 124);
  ctx.restore();
}

// Big center caption card. `line1` is the headline (wraps), `line2` a subtitle.
export function big(ctx, line1, line2) {
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const maxW = Math.min(760, W * 0.66), pad = 34, gap = 16;
  let s1 = 40; ctx.font = `600 ${s1}px system-ui`;
  let l1 = wrap(ctx, line1 || "", maxW);
  while (l1.length > 3 && s1 > 26) { s1 -= 3; ctx.font = `600 ${s1}px system-ui`; l1 = wrap(ctx, line1 || "", maxW); }
  const lh1 = s1 * 1.22, s2 = 21, lh2 = s2 * 1.35;
  let l2 = [];
  if (line2) { ctx.font = `${s2}px system-ui`; l2 = wrap(ctx, line2, maxW); }
  let tw = 0;
  ctx.font = `600 ${s1}px system-ui`; for (const l of l1) tw = Math.max(tw, ctx.measureText(l).width);
  ctx.font = `${s2}px system-ui`; for (const l of l2) tw = Math.max(tw, ctx.measureText(l).width);
  const textH = l1.length * lh1 + (l2.length ? gap + l2.length * lh2 : 0);
  const bw = Math.min(W * 0.95, tw + pad * 2), bh = textH + pad * 1.4, cx = W / 2, cy = H * 0.46;
  panel(ctx, cx, cy, bw, bh, 22);
  let top = cy - textH / 2;
  ctx.fillStyle = "#fff"; ctx.font = `600 ${s1}px system-ui`;
  for (const l of l1) { softText(ctx, l, cx, top + lh1 / 2); top += lh1; }
  if (l2.length) {
    top += gap; ctx.fillStyle = "rgba(232,226,255,0.85)"; ctx.font = `${s2}px system-ui`;
    for (const l of l2) { softText(ctx, l, cx, top + lh2 / 2); top += lh2; }
  }
  ctx.restore();
}
