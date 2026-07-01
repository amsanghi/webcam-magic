// capabilities.js — decide each device's AI tier and elect which peer generates.
//
// Tiers:
//   0  Static      no WebGPU (or opted out) — hand-written/pre-baked decks only
//   1  Light       WebGPU present but mobile/Safari/low-mem — tiny model (Qwen2.5-0.5B)
//   2  Powerhouse  desktop Chrome/Edge + WebGPU + enough memory — big model (Llama-3.1-8B)
//
// Everything AI-related is OPT-IN and lazy: detecting a tier never downloads a
// model. A T2 peer becomes the "LLM host" and broadcasts generated TEXT to the
// other peer (see host.ai in app.js), so the weaker device never runs a model.

const OVERRIDE_KEY = "wm_ai_tier";   // "auto" | "0" | "1" | "2"

export function getOverride() {
  try { return localStorage.getItem(OVERRIDE_KEY) || "auto"; } catch (_) { return "auto"; }
}
export function setOverride(v) {
  try { localStorage.setItem(OVERRIDE_KEY, v); } catch (_) {}
}

/** Probe the device; returns { tier, reason, model }. Never downloads anything. */
export async function detectTier() {
  const ov = getOverride();
  if (ov === "0") return tierInfo(0, "forced static");
  if (!navigator.gpu) return tierInfo(0, "no WebGPU");
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch (_) {}
  if (!adapter) return tierInfo(0, "no GPU adapter");

  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua));
  const isSafari = /^((?!chrome|android|crios|edg).)*safari/i.test(ua);
  const mem = navigator.deviceMemory || 0;   // GB, Chrome-only, capped at 8; undefined elsewhere

  if (ov === "2") return tierInfo(2, "forced powerhouse");
  if (ov === "1") return tierInfo(1, "forced light");

  // Auto: powerhouse needs a desktop Chromium engine with real memory headroom.
  if (!mobile && !isSafari && mem >= 8) return tierInfo(2, "desktop WebGPU + memory");
  // Anything else with working WebGPU gets the light tier.
  return tierInfo(1, mobile ? "mobile WebGPU" : "WebGPU (limited)");
}

// Default models per tier (overridable when creating the engine).
export const MODELS = {
  2: { engine: "webllm", model: "Llama-3.1-8B-Instruct-q4f16_1-MLC", approxMB: 4600 },
  1: { engine: "transformers", model: "onnx-community/Qwen2.5-0.5B-Instruct", approxMB: 400 },
};

// localStorage `wm_ai_model` overrides the tier-2 (WebLLM) model id — e.g. set
// it to a less-censored model like "Hermes-3-Llama-3.1-8B-q4f16_1-MLC".
function tierInfo(tier, reason) {
  let model = MODELS[tier] || null;
  if (tier === 2 && model) { let ov = null; try { ov = localStorage.getItem("wm_ai_model"); } catch (_) {} if (ov) model = { ...model, model: ov }; }
  return { tier, reason, model };
}

/**
 * Elect the generator between two peers. Higher tier wins; ties break to the
 * authority (player 0) so both ends agree deterministically.
 * @returns true if THIS device should be the LLM host.
 */
export function amGenerator(myTier, peerTier, authority) {
  if (peerTier == null) return myTier > 0;          // solo: I generate if capable
  if (myTier !== peerTier) return myTier > peerTier;
  return myTier > 0 && authority;                   // equal tiers → authority generates
}
