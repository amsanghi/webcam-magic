// lib.js — small shared helpers for modes: clamping and hand-cursor resolution.
// A "cursor" is the best pointing signal from a hand-gesture state: pinch beats
// point beats open palm. Coordinates are display-normalized [0..1] within a half.

import { W, H, toCanvas } from "../fx/effects.js";

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Best pointer for a gesture state g: pinch > point > palm. null if none. */
export function cursor(g) {
  if (!g) return null;
  if (g.pinch && g.pinch.active) return { x: g.pinch.x, y: g.pinch.y, down: true };
  if (g.point && g.point.active) return { x: g.point.x, y: g.point.y, down: false };
  if (g.palm) return { x: g.palm.x, y: g.palm.y, down: false };
  return null;
}

/** cursor(g) mapped to canvas px for the given side, or null. */
export function cursorPx(g, side) { const c = cursor(g); return c ? toCanvas(c, side) : null; }

/** Cursor for the player whose turn it is, in absolute canvas px (both halves). */
export function activeCur(local, remote, turnIdx) {
  const g = turnIdx === 0 ? local : remote;
  const c = cursor(g);
  return c ? { x: c.x * W, y: c.y * H, down: c.down } : null;
}
