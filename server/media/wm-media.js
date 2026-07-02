// wm-media.js — zero-dependency media service for webcam-magic's home server.
//
// Gives the static site a dead-simple API for the heavy generative jobs, forwarding
// to whatever's actually installed on your Mac. Sits behind proxy.js, so it shares
// the ONE ngrok tunnel (proxy routes /img /tts /stt here on :8189).
//
//   POST /img  {prompt, negative?, init?(dataURL), w?, h?, steps?, denoise?}  -> {image: dataURL}
//        -> forwards to an Automatic1111-compatible Stable Diffusion server
//           (A1111 / SD.Next / Forge) at SD_URL (default 127.0.0.1:7860).
//           init present => img2img ("stylize US" from a live frame); else txt2img.
//   POST /tts  {text, voice?}   -> audio/wav     (Piper, if installed)
//   POST /stt  (audio/wav body) -> {text}        (whisper.cpp, if installed)
//   GET  /health                -> {ok, sd}
//
// Everything degrades gracefully: if a backend isn't installed/reachable the call
// returns a clear error and the site falls back (never blocks the call).

const http = require("http");
const { spawn, exec } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const LISTEN = +(process.env.WM_MEDIA_PORT || 8189);
const SD_URL = (process.env.SD_URL || "http://127.0.0.1:7860").replace(/\/$/, "");
const PIPER_BIN = process.env.PIPER_BIN || "piper";                 // e.g. `brew install piper` or a downloaded binary
const PIPER_VOICE = process.env.PIPER_VOICE || "";                  // path to a .onnx voice model
const WHISPER_BIN = process.env.WHISPER_BIN || "whisper-cli";       // whisper.cpp (brew install whisper-cpp)
const WHISPER_MODEL = process.env.WHISPER_MODEL || "";              // path to a ggml-*.bin model

// ---- tiny helpers ---------------------------------------------------------
function readBody(req, cap = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > cap) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function json(res, code, obj) { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { "Content-Type": "application/json", "Content-Length": b.length }); res.end(b); }
// POST JSON to a local http server, resolve parsed JSON.
function postJSON(url, obj, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), body = Buffer.from(JSON.stringify(obj));
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": body.length } }, (up) => {
      const chunks = []; up.on("data", (c) => chunks.push(c)); up.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(e); } });
    });
    r.setTimeout(timeoutMs, () => { r.destroy(new Error("upstream timeout")); });
    r.on("error", reject); r.write(body); r.end();
  });
}
const stripDataUrl = (s) => String(s || "").replace(/^data:[^;]+;base64,/, "");

// ---- SD lifecycle: bring SD up on demand, tear it down when idle ------------
// SD is ephemeral. An /img request starts it (evicting the LLM first, so they never
// share RAM), generates, and then — a short idle after the last image — the SD
// process is KILLED (the only thing that actually frees its ~17 GB on Apple MPS).
// The LLM is evicted ONLY here (when SD comes up); it is NOT restarted when SD dies —
// it reloads on its own the next time a text/vision request reaches Ollama.
const SERVER_DIR = path.join(__dirname, "..");            // .../server (wm.sh lives here)
const SD_IDLE_MS = +(process.env.SD_IDLE_MS || 60000);    // kill SD this long after the last image
const SD_BOOT_MS = +(process.env.SD_BOOT_MS || 150000);   // max wait for a cold start
const _sdU = new URL(SD_URL);
function sh(cmd) { return new Promise((r) => { try { exec(cmd, { timeout: 15000 }, () => r()); } catch (_) { r(); } }); }
function sdReachable(ms = 2500) {
  return new Promise((res) => {
    const rq = http.request({ host: _sdU.hostname, port: _sdU.port, path: "/sdapi/v1/options", method: "GET", timeout: ms }, (u) => { u.resume(); res(u.statusCode === 200); });
    rq.on("error", () => res(false)); rq.on("timeout", () => { rq.destroy(); res(false); }); rq.end();
  });
}
let sdIdleTimer = null, sdStarting = null, sdModelLoaded = false;
function getJSON(url, ms = 8000) {
  return new Promise((res) => {
    const u = new URL(url);
    const rq = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: "GET", timeout: ms }, (up) => { const c = []; up.on("data", (x) => c.push(x)); up.on("end", () => { try { res(JSON.parse(Buffer.concat(c).toString("utf8"))); } catch (_) { res(null); } }); });
    rq.on("error", () => res(null)); rq.on("timeout", () => { rq.destroy(); res(null); }); rq.end();
  });
}
// SD.Next's API answers before the model is loaded → the first txt2img would abort
// ("model not loaded"). Force-load the checkpoint (POST /options blocks until ready).
async function sdLoadModel() {
  const models = await getJSON(SD_URL + "/sdapi/v1/sd-models");
  const title = models && models[0] && (models[0].title || models[0].model_name);
  if (!title) return false;
  try { await postJSON(SD_URL + "/sdapi/v1/options", { sd_model_checkpoint: title }, 180000); return true; } catch (_) { return false; }
}
function cancelSDKill() { if (sdIdleTimer) { clearTimeout(sdIdleTimer); sdIdleTimer = null; } }
function scheduleSDKill() {
  cancelSDKill();
  sdIdleTimer = setTimeout(async () => {
    sdIdleTimer = null; sdModelLoaded = false;
    console.log("[wm-media] SD idle " + SD_IDLE_MS + "ms — killing to free RAM");
    await sh("pkill -f 'launch.py --api'"); await sh("pkill -f 'webui.sh'");
  }, SD_IDLE_MS);
}
function ensureSDup() {
  if (sdStarting) return sdStarting;   // dedupe concurrent starts
  sdStarting = (async () => {
    if (!(await sdReachable())) {
      console.log("[wm-media] bringing SD up (evicting the LLM first)…");
      await sh("ollama stop active");   // free the LLM's RAM — the ONLY place the LLM is evicted
      try { spawn("bash", [path.join(SERVER_DIR, "wm.sh"), "sd"], { detached: true, stdio: "ignore" }).unref(); } catch (_) {}
      const deadline = Date.now() + SD_BOOT_MS;
      while (Date.now() < deadline && !(await sdReachable())) await new Promise((r) => setTimeout(r, 2500));
      if (!(await sdReachable())) return false;
      sdModelLoaded = false;
    }
    if (!sdModelLoaded) { console.log("[wm-media] loading SD checkpoint…"); sdModelLoaded = await sdLoadModel(); }
    return sdModelLoaded;
  })().finally(() => { sdStarting = null; });
  return sdStarting;
}

// ---- /img : Automatic1111-compatible txt2img / img2img --------------------
async function genImage(spec) {
  const w = Math.min(1024, spec.w || 768), h = Math.min(1024, spec.h || 768);
  const steps = Math.min(40, spec.steps || 26);
  const neg = spec.negative || "lowres, deformed, extra limbs, bad anatomy, watermark, text";
  if (spec.init) {
    const out = await postJSON(SD_URL + "/sdapi/v1/img2img", {
      init_images: [stripDataUrl(spec.init)], prompt: spec.prompt, negative_prompt: neg,
      denoising_strength: spec.denoise != null ? spec.denoise : 0.55, steps, width: w, height: h, cfg_scale: spec.cfg || 6.5,
    });
    return out && out.images && out.images[0];
  }
  const out = await postJSON(SD_URL + "/sdapi/v1/txt2img", {
    prompt: spec.prompt, negative_prompt: neg, steps, width: w, height: h, cfg_scale: spec.cfg || 6.5,
  });
  return out && out.images && out.images[0];
}

// ---- /tts and /stt via subprocess (optional) ------------------------------
function runToBuffer(bin, args, stdinBuf) {
  return new Promise((resolve, reject) => {
    let p; try { p = spawn(bin, args); } catch (e) { return reject(e); }
    const out = [], err = [];
    p.stdout.on("data", (c) => out.push(c)); p.stderr.on("data", (c) => err.push(c));
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error((Buffer.concat(err).toString() || "exit " + code).slice(0, 300))));
    if (stdinBuf) { p.stdin.write(stdinBuf); p.stdin.end(); }
  });
}
async function tts(text, voice) {
  const model = voice || PIPER_VOICE; if (!model) throw new Error("no PIPER_VOICE set");
  const tmp = path.join(os.tmpdir(), "wm-tts-" + Math.abs(hashStr(text)) + ".wav");
  await runToBuffer(PIPER_BIN, ["--model", model, "--output_file", tmp], Buffer.from(String(text)));
  const buf = fs.readFileSync(tmp); try { fs.unlinkSync(tmp); } catch (_) {} return buf;
}
async function stt(inBuf) {
  if (!WHISPER_MODEL) throw new Error("no WHISPER_MODEL set");
  const base = path.join(os.tmpdir(), "wm-stt-" + Date.now());
  const raw = base + ".in", wav = base + ".wav";
  fs.writeFileSync(raw, inBuf);
  // browsers record webm/opus (or mp4 on Safari); whisper.cpp wants 16k mono WAV.
  try { await runToBuffer("ffmpeg", ["-y", "-i", raw, "-ar", "16000", "-ac", "1", "-f", "wav", wav]); } catch (_) {}
  const src = fs.existsSync(wav) ? wav : raw;
  const out = await runToBuffer(WHISPER_BIN, ["-m", WHISPER_MODEL, "-f", src, "-nt", "-otxt", "-of", base]);
  let text = ""; try { text = fs.readFileSync(base + ".txt", "utf8").trim(); } catch (_) { text = out.toString().trim(); }
  for (const f of [raw, wav, base + ".txt"]) try { fs.unlinkSync(f); } catch (_) {}
  return text;
}
function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }

// ---- server ---------------------------------------------------------------
http.createServer(async (req, res) => {
  // CORS is added by proxy.js in front of us, but allow direct hits too.
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = (req.url || "").split("?")[0];
  try {
    if (req.method === "GET" && url === "/health") {
      let sd = false; try { await postJSON(SD_URL + "/sdapi/v1/options", {}, 2500).then(() => (sd = true)).catch(() => {}); } catch (_) {}
      return json(res, 200, { ok: true, sd, sdUrl: SD_URL });
    }
    if (req.method === "POST" && url === "/img") {
      const spec = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!spec.prompt) return json(res, 400, { error: "prompt required" });
      cancelSDKill();                                    // in use — don't let the idle timer kill it mid-work
      const up = await ensureSDup();                     // start SD (evicting the LLM) if down; first image may cold-start ~1 min
      if (!up) { scheduleSDKill(); return json(res, 503, { error: "SD didn't come up in time" }); }
      // SD.Next's API answers 200 before it can actually generate, so the first
      // txt2img can come back empty. Retry a few times, re-loading the checkpoint
      // between tries, until it produces an image.
      let b64 = null, err = null;
      for (let attempt = 0; attempt < 6 && !b64; attempt++) {
        if (attempt > 0) { await new Promise((r) => setTimeout(r, 5000)); await sdLoadModel(); }
        try { b64 = await genImage(spec); } catch (e) { err = (e && e.message) || String(e); }
      }
      scheduleSDKill();                                  // work done → kill SD after it's idle (frees ~17 GB)
      if (!b64) return json(res, 502, { error: err || "no image from SD backend (not ready?)" });
      return json(res, 200, { image: b64.startsWith("data:") ? b64 : "data:image/png;base64," + b64 });
    }
    if (req.method === "POST" && url === "/tts") {
      const spec = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const wav = await tts(spec.text || "", spec.voice);
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wav.length }); return res.end(wav);
    }
    if (req.method === "POST" && url === "/stt") {
      const text = await stt(await readBody(req));
      return json(res, 200, { text });
    }
    json(res, 404, { error: "not found" });
  } catch (e) { json(res, 500, { error: (e && e.message) || String(e) }); }
}).listen(LISTEN, "127.0.0.1", () => console.log("wm-media :" + LISTEN + " -> SD " + SD_URL + " (img), Piper (tts), whisper.cpp (stt)"));
