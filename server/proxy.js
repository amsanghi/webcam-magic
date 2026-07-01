// proxy.js — tiny zero-dependency CORS + Host-rewrite reverse proxy in front of
// Ollama. ngrok points here (11435); this forwards to Ollama (11434).
//
// Why it's needed: through free ngrok the browser must send the
// `ngrok-skip-browser-warning` header (to skip ngrok's interstitial), but
// Ollama's fixed CORS allow-list rejects that header on preflight, and Ollama
// also 403s any request whose Host isn't localhost. This proxy answers the CORS
// preflight permissively (echoing requested headers) and rewrites Host to
// localhost, so browser fetches work — while staying local to your Mac.

const http = require("http");
const UP_HOST = "127.0.0.1", UP_PORT = 11434, LISTEN = 11435;

http.createServer((req, res) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const up = http.request(
    { host: UP_HOST, port: UP_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: UP_HOST + ":" + UP_PORT } },
    (ur) => {
      const h = { ...ur.headers };
      for (const k of Object.keys(h)) if (k.toLowerCase().startsWith("access-control-")) delete h[k]; // avoid duplicate CORS headers
      res.writeHead(ur.statusCode, h);
      ur.pipe(res);
    }
  );
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(LISTEN, "127.0.0.1", () => console.log("webcam-magic CORS proxy :" + LISTEN + " -> Ollama :" + UP_PORT));
