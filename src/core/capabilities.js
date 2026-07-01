// capabilities.js — decide each device's AI tier and elect which peer generates.
//
// Tiers (best → worst — graceful degradation):
//   3  Server      a reachable home AI server (your Mac running Ollama etc.)
//   2  Powerhouse  desktop Chrome/Edge + WebGPU + memory — big in-browser model
//   1  Light       WebGPU but mobile/Safari/low-mem — tiny in-browser model
//   0  Static      no WebGPU / opted out — hand-written decks
//
// A reachable server beats everything and can be shared to the partner over the
// data channel, so ONE strong Mac serves both of you (and your phones) anywhere.

const OVERRIDE_KEY = "wm_ai_tier";          // "auto" | "0" | "1" | "2"
const SERVER_KEY = "wm_ai_server";          // e.g. https://xyz.trycloudflare.com
const SERVER_MODEL_KEY = "wm_ai_server_model";
const DEFAULT_SERVER_MODEL = "active";   // an Ollama alias the server re-points (see server/start.sh)

export function getOverride() { try { return localStorage.getItem(OVERRIDE_KEY) || "auto"; } catch (_) { return "auto"; } }
export function setOverride(v) { try { localStorage.setItem(OVERRIDE_KEY, v); } catch (_) {} }
export function getServer() { try { return (localStorage.getItem(SERVER_KEY) || "").trim(); } catch (_) { return ""; } }
export function setServer(u) { try { if (u) localStorage.setItem(SERVER_KEY, u.trim()); else localStorage.removeItem(SERVER_KEY); } catch (_) {} }
export function getServerModel() { try { return localStorage.getItem(SERVER_MODEL_KEY) || DEFAULT_SERVER_MODEL; } catch (_) { return DEFAULT_SERVER_MODEL; } }
export function setServerModel(m) { try { if (m) localStorage.setItem(SERVER_MODEL_KEY, m); } catch (_) {} }

// Header set on every server request. `ngrok-skip-browser-warning` bypasses the
// ngrok free-tier interstitial page (otherwise browser fetches get HTML, not JSON).
export const SERVER_HEADERS = { "ngrok-skip-browser-warning": "true" };

/** Ping an OpenAI/Ollama-compatible server. true only if it returns real JSON. */
export async function checkServer(url) {
  if (!url) return false;
  const base = url.replace(/\/$/, "");
  for (const path of ["/api/tags", "/v1/models"]) {
    try {
      const r = await fetch(base + path, { headers: SERVER_HEADERS, signal: AbortSignal.timeout(3500) });
      if (r.ok) { const j = await r.json().catch(() => null); if (j) return true; }  // must be JSON, not the ngrok HTML page
    } catch (_) {}
  }
  return false;
}

// Default in-browser models per tier.
export const MODELS = {
  2: { engine: "webllm", model: "Llama-3.1-8B-Instruct-q4f16_1-MLC", approxMB: 4600 },
  1: { engine: "transformers", model: "onnx-community/Qwen2.5-0.5B-Instruct", approxMB: 400 },
};

/** Probe the device; returns { tier, reason, model }. May do a quick server ping. */
export async function detectTier() {
  const ov = getOverride();
  if (ov === "0") return tierInfo(0, "forced static");
  // Tier 3 — a reachable home server beats everything.
  const server = getServer();
  if (server && await checkServer(server)) return tierInfo(3, "home server", server);
  if (!navigator.gpu) return tierInfo(0, "no WebGPU");
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch (_) {}
  if (!adapter) return tierInfo(0, "no GPU adapter");

  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua));
  const isSafari = /^((?!chrome|android|crios|edg).)*safari/i.test(ua);
  const mem = navigator.deviceMemory || 0;

  if (ov === "2") return tierInfo(2, "forced powerhouse");
  if (ov === "1") return tierInfo(1, "forced light");
  if (!mobile && !isSafari && mem >= 8) return tierInfo(2, "desktop WebGPU + memory");
  return tierInfo(1, mobile ? "mobile WebGPU" : "WebGPU (limited)");
}

function tierInfo(tier, reason, serverUrl) {
  let model = null;
  if (tier === 3) model = { engine: "server", url: serverUrl, model: getServerModel(), approxMB: 0 };
  else if (tier === 2) { model = { ...MODELS[2] }; let ov = null; try { ov = localStorage.getItem("wm_ai_model"); } catch (_) {} if (ov) model.model = ov; }
  else if (tier === 1) model = { ...MODELS[1] };
  return { tier, reason, model };
}

/**
 * Elect the generator between two peers. Higher tier wins; ties break to the
 * authority (player 0) so both ends agree. (When a server is in play both peers
 * are typically tier 3 and each just calls the server directly.)
 */
export function amGenerator(myTier, peerTier, authority) {
  if (peerTier == null) return myTier > 0;
  if (myTier !== peerTier) return myTier > peerTier;
  return myTier > 0 && authority;
}
