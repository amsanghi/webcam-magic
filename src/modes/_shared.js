// _shared.js — one-stop barrel so each mode file needs a single import line.
// Re-exports the FX namespace, common FX constants, the live runtime context
// (net/host/authority/meIdx), the cursor helpers, and the UI drawing helpers.

export * as FX from "../fx/effects.js";
export { W, H, MID, toCanvas, rnd, pick } from "../fx/effects.js";
export { net, host, authority, meIdx } from "./context.js";
export { clamp, cursor, cursorPx, activeCur } from "./lib.js";
export { roundRect, pill, outline, fit, hint, scoreboard, big } from "./ui.js";
