// context.js — shared runtime context for every mode factory.
//
// Modes used to be closures inside games.js that captured `net`, `host` and the
// `authority` flag. To let each mode live in its own file we expose those same
// three things here as ES-module *live bindings*: app.js calls initContext()
// once at boot, and because module exports are live, every mode file that
// imports `net`/`host`/`authority` sees the current value with no wiring.
//
// - net.send(obj)  broadcasts a small JSON message to the partner (app routes
//   non-gesture messages to the active mode's onNet()).
// - host          shared services (snapshot/ask/objects/pose/seg/audio/…).
// - authority     true on player 0 (LEFT, the single judge for scored games).

export let net = null;
export let host = null;
export let authority = true;

/** Wire the live bindings once, from app.js, before any mode is entered. */
export function initContext(o) { net = o.net; host = o.host; }

/** Called by app.js when roles are resolved from the exchanged stable pid. */
export function setAuthority(b) { authority = b; }

/** This client's absolute player index (authority = player 0). */
export const meIdx = () => (authority ? 0 : 1);
