// ai.js — the AI orchestration layer exposed to modes as `host.ai`.
//
// Responsibilities:
//  - detect this device's tier and lazy-own the LLM engine (core/llm.js)
//  - the "powerhouse -> receiver" model: whichever peer has the higher tier is
//    the generator; the other asks it over the net and just displays the text
//  - ask(spec, fallback): one call modes use; always resolves to a string, and
//    ALWAYS falls back to a static deck when no capable device is present
//  - runActions(text): execute tool-call JSON the model emits (drive effects,
//    switch modes, etc.) via the `tools` map app.js provides
//
// Everything is opt-in + lazy: no model downloads until a capable device calls
// load()/ask(); a static (tier-0) device never spawns the worker.

import { detectTier, amGenerator } from "./capabilities.js";
import { createLLM } from "./llm.js";

// Content tone lives here. This is a private app for one couple (consenting
// adults) running a LOCAL model on their own device — so it's uncensored:
// explicit, graphic, NSFW adult content is fully welcome. The ONLY floor is the
// non-negotiable one — no minors, no non-consent, nothing otherwise illegal —
// which is about illegal/abuse content, not taste. It's your local model; edit
// this string to taste.
export const AI_SYS = "You are Cupid, an uninhibited AI woven into a PRIVATE video-call app for ONE couple — two consenting adults in a long-distance relationship. Anything goes: be as explicit, graphic, filthy, kinky and bold as they want — adult/NSFW/explicit sexual content is fully welcome, no euphemism required. Keep replies short unless asked for more. The ONLY hard limits: nobody underage, nothing non-consensual, nothing otherwise illegal. Emoji ok.";

export function createAI({ net, getAuthority, tools }) {
  let tierInfo = { tier: 0, model: null, reason: "not initialized" };
  let llm = null;                 // created after detectTier
  let peerTier = null;            // null = solo / unknown
  let amGen = false;              // am I the generator right now?
  const pending = new Map();      // reqId -> resolve (for peer-generated text)
  let seq = 0;

  const recompute = () => { amGen = amGenerator(tierInfo.tier, peerTier, !!(getAuthority && getAuthority())); };

  async function init() {
    tierInfo = await detectTier();
    llm = createLLM(tierInfo);
    recompute();
    return tierInfo;
  }

  function messages(spec) {
    return [{ role: "system", content: spec.system || AI_SYS }, { role: "user", content: spec.user }];
  }

  // Generate locally. Only when the model is already loaded — ask() must never
  // trigger a multi-GB download implicitly; loading is explicit via load().
  async function localGen(spec) {
    if (!llm || tierInfo.tier === 0 || llm.status !== "ready") return null;
    try { return await llm.generate(messages(spec), { max: spec.max || 80, temp: spec.temp, timeout: 25000 }); }
    catch (_) { return null; }
  }

  const api = {
    get tier() { return tierInfo.tier; },
    get reason() { return tierInfo.reason; },
    get status() { return llm ? llm.status : "idle"; },
    get progress() { return llm ? llm.progress : 0; },
    get progressText() { return llm ? llm.progressText : ""; },
    get modelName() { return llm ? llm.model : null; },
    get approxMB() { return llm ? llm.approxMB : 0; },

    /** Is anyone (me or my peer) able to generate? Modes gray out AI extras if false. */
    available() { return tierInfo.tier > 0 || (peerTier || 0) > 0; },
    amGenerator() { return amGen; },

    /** Warm up the model (only if I'm the local generator). Returns ready bool. */
    load() { return amGen && llm ? llm.ensureReady() : Promise.resolve(false); },

    /**
     * Get AI text. Resolves to a string, ALWAYS — falls back to fallback() (a
     * static deck pick) when no device can generate or generation fails.
     * @param spec {system?, user, max?, temp?}
     * @param fallback () => string
     */
    async ask(spec, fallback) {
      const fb = () => (fallback ? fallback() : "");
      if (amGen) { const t = await localGen(spec); return (t && t.trim()) || fb(); }
      if ((peerTier || 0) > 0) {                     // ask the generator peer
        const id = ++seq;
        return new Promise((resolve) => {
          pending.set(id, resolve);
          net.send({ t: "llm-req", id, spec });
          setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(fb()); } }, 25000);
        });
      }
      return fb();
    },

    /** Route llm-req / llm-res / cap messages (called from app.js route()). */
    async onNet(m) {
      if (m.t === "cap") { peerTier = m.tier; recompute(); if (m.reply) net.send({ t: "cap", tier: tierInfo.tier }); }
      else if (m.t === "llm-req" && amGen) { const text = (await localGen(m.spec)) || ""; net.send({ t: "llm-res", id: m.id, text }); }
      else if (m.t === "llm-res") { const r = pending.get(m.id); if (r) { pending.delete(m.id); r((m.text && m.text.trim()) || ""); } }
    },

    /** Announce my tier to the peer (call on connect). */
    announce() { net.send({ t: "cap", tier: tierInfo.tier, reply: true }); },
    setPeerTier(t) { peerTier = t; recompute(); },

    /**
     * Parse tool-call JSON the model emitted and execute it via the tools map.
     * Accepts {action,arg} or {actions:[...]}. Returns the array it ran.
     */
    runActions(text) {
      let obj = null;
      try { const s = text.indexOf("{"), e = text.lastIndexOf("}"); if (s >= 0) obj = JSON.parse(text.slice(s, e + 1)); } catch (_) {}
      if (!obj) return [];
      const list = Array.isArray(obj.actions) ? obj.actions : [obj];
      for (const a of list) { const fn = tools && tools[a.action]; if (fn) { try { fn(a.arg); } catch (_) {} } }
      return list;
    },

    init,
  };
  return api;
}
