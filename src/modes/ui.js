// ui.js — shared canvas text/box helpers used across modes for readable HUD:
// rounded chips, outlined text, a title/score board, and a big center banner.
// All drawing is in the logical 1280x720 space (see fx/effects.js).

import { W, H } from "../fx/effects.js";
import { meIdx } from "./context.js";

export function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function pill(ctx, txt, x, y, size) {          // dark rounded chip behind text
  ctx.font = `${size}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(txt).width + size * 1.6;
  ctx.fillStyle = "rgba(8,10,16,.55)"; roundRect(ctx, x - w / 2, y - size, w, size * 2, size); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.fillText(txt, x, y);
}
export function outline(ctx, t, x, y, size) {         // bold white text w/ dark outline
  ctx.font = `bold ${size}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, size * 0.15); ctx.strokeStyle = "rgba(0,0,0,.78)"; ctx.strokeText(t, x, y);
  ctx.fillStyle = "#fff"; ctx.fillText(t, x, y);
}
export function fit(ctx, t, max, size, bold) { ctx.font = `${bold ? "bold " : ""}${size}px system-ui`; while (size > 14 && ctx.measureText(t).width > max) { size -= 2; ctx.font = `${bold ? "bold " : ""}${size}px system-ui`; } return size; }
export function hint(ctx, txt) { ctx.save(); pill(ctx, txt, W / 2, H - 30, 15); ctx.restore(); }
export function scoreboard(ctx, score, time, title) {
  ctx.save();
  pill(ctx, title + (time != null ? `  •  ${Math.max(0, Math.ceil(time))}s` : ""), W / 2, 30, 15);
  outline(ctx, `${score[0]}`, W * 0.25, 84, 46); outline(ctx, `${score[1]}`, W * 0.75, 84, 46);
  ctx.font = "14px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(255,255,255,.8)";
  const mine = meIdx();
  ctx.fillText(mine === 0 ? "you" : "partner", W * 0.25, 120); ctx.fillText(mine === 0 ? "partner" : "you", W * 0.75, 120);
  ctx.restore();
}
export function big(ctx, line1, line2) {
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
