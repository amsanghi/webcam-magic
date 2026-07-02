// proxy.js — zero-dependency CORS + Host-rewrite reverse proxy AND memory arbiter
// in front of the home AI services. ngrok points here (11435). Path-routes:
//
//   /img, /tts, /stt, /media/*   -> wm-media (:8189)   [images / voice]
//   everything else              -> Ollama (:11434)    [text + vision]
//
// Why the proxy: through free ngrok the browser must send `ngrok-skip-browser-warning`,
// but Ollama's fixed CORS rejects that header on preflight and 403s non-localhost Host.
// This answers preflight permissively and rewrites Host to localhost.
//
// MEMORY ARBITER (so SD + the LLM never fight for RAM on a 32GB Mac):
// this proxy is the only thing that sees BOTH the LLM (/v1,/api) and image (/img)
// traffic, so it enforces one-at-a-time. On the first *generation* request of a kind
// after using the other, it unloads the other's model BEFORE forwarding —
//   image request -> `ollama stop active`            (frees ~9 GB; reloads in ~5 s)
//   text request  -> SD `/sdapi/v1/unload-checkpoint`(frees SD's model; reloads ~15-20 s)
// Both server processes stay up (fast revival). Only real generation calls switch;
// health/metadata pings (/api/tags, /v1/models, /tts, /stt) never evict anything.

const http = require("http");
const { exec } = require("child_process");
const OLLAMA = { host: "127.0.0.1", port: 11434 };
const MEDIA = { host: "127.0.0.1", port: 8189 };
const SD_PORT = 7860;
const LISTEN = 11435;
const isMedia = (url) => /^\/(img|tts|stt|media)(\/|$|\?)/.test(url || "");

// --- memory arbiter ---------------------------------------------------------
let active = null;   // "img" | "llm" — which model is currently allowed to be resident
function kindOf(url) {
  if (/^\/(img\b|sdapi\/v1\/(txt2img|img2img))/.test(url)) return "img";
  if (/^\/(v1\/chat\/completions|api\/(chat|generate|embeddings))/.test(url)) return "llm";
  return null;   // tags/models/tts/stt/health → not a generation, don't switch
}
function ollamaUnload() { return new Promise((r) => { try { exec("ollama stop active", { timeout: 12000 }, () => r()); } catch (_) { r(); } }); }
function sdUnload() {
  return new Promise((r) => {
    const req = http.request({ host: "127.0.0.1", port: SD_PORT, path: "/sdapi/v1/unload-checkpoint", method: "POST", timeout: 12000 }, (u) => { u.resume(); u.on("end", r); });
    req.on("error", () => r()); req.on("timeout", () => { req.destroy(); r(); }); req.end();
  });
}
async function arbitrate(url) {
  const kind = kindOf(url);
  if (!kind || kind === active) return;   // no switch → nothing to evict
  active = kind;
  try { await (kind === "img" ? ollamaUnload() : sdUnload()); } catch (_) {}
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  await arbitrate(req.url);   // free the OTHER model on a text<->image switch (the request body stays buffered)

  const target = isMedia(req.url) ? MEDIA : OLLAMA;
  const up = http.request(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host + ":" + target.port } },
    (ur) => {
      const h = { ...ur.headers };
      for (const k of Object.keys(h)) if (k.toLowerCase().startsWith("access-control-")) delete h[k]; // avoid duplicate CORS headers
      res.writeHead(ur.statusCode, h);
      ur.pipe(res);
    }
  );
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(LISTEN, "127.0.0.1", () => console.log("webcam-magic proxy :" + LISTEN + " -> Ollama + wm-media (SD/LLM memory arbiter on)"));
