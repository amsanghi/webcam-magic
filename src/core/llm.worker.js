// llm.worker.js — module Web Worker that runs the language model off the main
// thread (so the render loop + video call stay smooth). Lazy-loads either
// WebLLM (tier 2) or transformers.js (tier 1) from a CDN — nothing is fetched
// until an `init` message arrives, so a static-tier device never touches this.
//
// Messages IN:  {type:"init", engine, model}          load a model
//               {type:"gen", id, messages, opts}      generate a completion
// Messages OUT: {type:"progress", pct, text}          load progress 0..1
//               {type:"ready"} | {type:"error", error}
//               {type:"result", id, text} | {type:"gen-error", id, error}

let engineKind = null;   // "webllm" | "transformers"
let webllm = null;       // WebLLM engine instance
let pipe = null;         // transformers.js pipeline

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") await init(m.engine, m.model);
    else if (m.type === "gen") await gen(m.id, m.messages, m.opts || {});
  } catch (err) {
    self.postMessage({ type: m.type === "gen" ? "gen-error" : "error", id: m.id, error: String((err && err.message) || err) });
  }
};

async function init(engine, model) {
  engineKind = engine;
  const onProg = (pct, text) => self.postMessage({ type: "progress", pct, text });
  if (engine === "webllm") {
    const wl = await import("https://esm.run/@mlc-ai/web-llm");
    webllm = await wl.CreateMLCEngine(model, {
      initProgressCallback: (p) => onProg(p.progress ?? 0, p.text || ""),
    });
  } else {
    const t = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3");
    pipe = await t.pipeline("text-generation", model, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: (p) => { if (p.status === "progress" && p.total) onProg(p.loaded / p.total, p.file || ""); },
    });
  }
  self.postMessage({ type: "ready" });
}

async function gen(id, messages, opts) {
  const max = opts.max || 128, temp = opts.temp ?? 0.9;
  let text = "";
  if (engineKind === "webllm") {
    const r = await webllm.chat.completions.create({ messages, temperature: temp, max_tokens: max });
    text = (r.choices && r.choices[0] && r.choices[0].message.content) || "";
  } else {
    const out = await pipe(messages, { max_new_tokens: max, temperature: temp, do_sample: true, return_full_text: false });
    const g = out[0].generated_text;
    text = Array.isArray(g) ? (g.at(-1).content || "") : String(g);
  }
  self.postMessage({ type: "result", id, text: text.trim() });
}
