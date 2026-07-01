// llm.js — main-thread manager around llm.worker.js. Owns the worker, load
// state, and a promise-based generate(). Everything is lazy: the worker (and
// therefore the CDN engine + model download) is only created on the first
// ensureReady() call, which happens when a capable device opts into an AI mode.

export function createLLM(tierInfo) {
  let worker = null;
  let status = "idle";            // idle | loading | ready | error
  let progress = 0, progressText = "", error = "";
  let readyResolve = null, readyPromise = null;
  const pending = new Map();      // id -> {resolve, reject}
  let seq = 0;

  function spawn() {
    worker = new Worker(new URL("./llm.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") { progress = m.pct || 0; progressText = m.text || ""; }
      else if (m.type === "ready") { status = "ready"; readyResolve && readyResolve(true); }
      else if (m.type === "error") { status = "error"; error = m.error; readyResolve && readyResolve(false); }
      else if (m.type === "result") { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.resolve(m.text); } }
      else if (m.type === "gen-error") { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.reject(new Error(m.error)); } }
    };
    worker.onerror = (e) => { status = "error"; error = String(e.message || e); readyResolve && readyResolve(false); };
  }

  /** Load the model (idempotent). Resolves true when ready, false on failure. */
  function ensureReady() {
    if (status === "ready") return Promise.resolve(true);
    if (readyPromise) return readyPromise;
    if (!tierInfo || !tierInfo.model) return Promise.resolve(false);
    status = "loading";
    readyPromise = new Promise((res) => { readyResolve = res; });
    try { spawn(); worker.postMessage({ type: "init", engine: tierInfo.model.engine, model: tierInfo.model.model }); }
    catch (e) { status = "error"; error = String(e); return Promise.resolve(false); }
    return readyPromise;
  }

  /** Generate a completion from a chat message array. Rejects if not ready. */
  function generate(messages, opts = {}) {
    if (status !== "ready") return Promise.reject(new Error("llm not ready"));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: "gen", id, messages, opts });
      if (opts.timeout) setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout")); } }, opts.timeout);
    });
  }

  return {
    tier: tierInfo ? tierInfo.tier : 0,
    model: tierInfo && tierInfo.model ? tierInfo.model.model : null,
    approxMB: tierInfo && tierInfo.model ? tierInfo.model.approxMB : 0,
    get status() { return status; },
    get progress() { return progress; },
    get progressText() { return progressText; },
    get error() { return error; },
    ensureReady, generate,
  };
}
