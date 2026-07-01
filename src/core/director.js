// director.js — the AI "host" that actually runs the show.
//
// It doesn't just react — it SEES (an occasional vision glance via host.ai.see),
// FEELS the room (energy / mood / lull from getRoom), REMEMBERS (episodic memory +
// end-of-night recaps), and PACES THE NIGHT as a gentle 5-act arc
// (warmup → connect → play → spice → winddown). In Host mode it takes the wheel and
// auto-switches activities (cancelable); otherwise it greets, drops one-tap chips,
// and keeps things warm. Built on host.ai.ask(spec, fallback) so it stays lively
// with NO model and gets smarter/custom with one. Autopilot runs from the authority
// only (so both screens don't fight); shared beats broadcast.

import { ICON } from "./icons.js";

// modes the host spins up, grouped by which act they suit. Unknown ids are filtered
// out by has(); every act keeps a couple of always-present ids so it's never empty.
const BY_ACT = {
  warmup: ["thisorthat", "wyr", "rps", "pop", "spinner"],
  connect: ["deeptalk", "telepathy", "aideep", "q36", "howwell", "twotruths"],
  play: ["dancebattle", "charades", "pictionary", "catch", "photobooth", "trivia", "reaction"],
  spice: ["truthdare", "loversdice", "neverhave", "roleplay", "aitruth"],
  winddown: ["oursong", "stars", "mood", "breathe", "slowdance", "kisscam"],
};
const SAFE = ["kisscam", "dancebattle", "truthdare", "rps", "pop", "catch", "deeptalk", "telepathy", "thisorthat", "spinner", "wyr", "photobooth", "charades", "pictionary", "loversdice"];

export function createDirector({ ai, chat, tools, nav, modeAction, getMode, getModeActions, getModeInfo, modeIcon, isAuthority, memory, getRoom, grabFrame }) {
  let hostOn = false, lastBeat = 0, switchPending = false, greeted = "";
  let act = "warmup", actSince = 0, beats = 0, lastGlance = 0, greetedSession = false, recapDone = false;

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const rand = (a) => a[Math.floor(Math.random() * a.length)];
  const names = () => (memory ? memory.names() : "you two");
  const room = () => (getRoom ? getRoom() || {} : {});
  const spiceCeil = () => (memory && memory.spice != null ? memory.spice : 2);
  const has = (id) => !!getModeInfo(id);
  const poolFor = (a) => { let p = (BY_ACT[a] || []).filter(has); if (!p.length) p = SAFE.filter(has); return p.length ? p : SAFE; };
  function pickMode(exclude) { const p = poolFor(act).filter((m) => m !== exclude); return p.length ? rand(p) : "spinner"; }
  const chip = (label, icon, run) => ({ label, icon, run });
  const iconOf = (id) => { const mi = getModeInfo(id); return modeIcon(id, mi && mi.cat); };

  // tone the AI uses right now: while hosting it follows the act's natural heat,
  // capped by the spice dial; when not hosting it's just the dial (full control).
  function toneNow() {
    const lvl = hostOn ? Math.min(act === "spice" ? 2 : 1, spiceCeil()) : spiceCeil();
    if (ai.setTone) ai.setTone(lvl);
    return lvl;
  }
  // memory-aware system preface for the host's own lines
  const hostSys = (extra) => `You are Cupid, the warm, playful${spiceCeil() >= 2 ? ", uninhibited" : ""} host of a private couple's video-call app. ${extra || ""}${memory ? memory.forPrompt() : ""} Reply with ONE short line, emoji ok, no quotes, <=16 words.`;

  // ---- personalization -----------------------------------------------------
  async function ensureNames() {
    if (memory && memory.profile.a) return;
    const v = await chat.ask("Before I host — what should I call you two? (e.g. Alex & Sam)");
    if (!v) return;
    const parts = v.split(/&|,|\band\b|\+/i).map((s) => s.trim()).filter(Boolean);
    if (memory) { memory.setProfile({ a: parts[0] || "", b: parts[1] || "" }); if (memory.profile.a) chat.say("ai", `Love it — ${names()} it is 💫`); }
  }

  // ---- session greeting: call back to last night if we remember one --------
  function sessionGreet() {
    if (greetedSession) return; greetedSession = true;
    const lr = memory && memory.lastRecap();
    if (!lr) return;
    const fb = `back for more, ${names()}? 💕`;
    if (ai.available()) ai.ask({ system: hostSys("Greet them warmly and reference last time in a few words, to show you remember."), user: `Last time: ${lr.text}`, max: 40, temp: 1.05 }, () => fb).then((t) => chat.say("ai", (t || fb).trim()));
    else chat.say("ai", fb);
  }

  // ---- host (autopilot) toggle --------------------------------------------
  async function setHost(on) {
    hostOn = on;
    if (on) {
      await ensureNames();
      act = "warmup"; actSince = now(); recapDone = false; toneNow();
      chat.say("ai", rand([`Okay ${names()}, I've got the night 🎬`, `Host mode on — sit back, ${names()} ✨`, `Leave it to me, ${names()} 💕`]));
      lastBeat = now();
      sessionGreet();
    } else { if (ai.setTone) ai.setTone(spiceCeil()); chat.say("ai", "All yours again — tap me back in whenever ✨"); }
    return hostOn;
  }
  const isOn = () => hostOn;

  // ---- per-mode intro (runs on entering ANY mode) --------------------------
  function intro(modeId) {
    const mi = getModeInfo(modeId); if (!mi) return;
    greeted = modeId; toneNow();
    if (memory) memory.note("mode", `opened ${mi.nm}`);
    sessionGreet();
    const fb = rand([`${mi.nm} — nice pick, ${names()} 💕`, `Ooh, ${mi.nm}. let's make it fun ✨`, `${mi.nm} it is — I'm right here 💫`, `${names()}, ${mi.nm} time 🎬`]);
    const chips = () => { if (greeted === modeId) chat.actions(introChips(modeId, mi.cat || "")); };
    if (ai.available()) {
      ai.ask({ system: hostSys(`React to them opening the "${mi.nm}" activity and invite them in.`), user: `They opened ${mi.nm}.`, max: 40, temp: 1.05 }, () => fb)
        .then((t) => { if (greeted === modeId) { chat.say("ai", (t || fb).trim()); chips(); } });
    } else { chat.say("ai", fb); chips(); }
  }
  function introChips(modeId, cat) {
    const chips = [];
    if (cat.includes("Talk") || cat.includes("AI")) chips.push(chip("Fresh one", ICON.sparkles, () => primaryAction(modeId)));
    else if (cat === "Games" || cat.includes("senses")) chips.push(chip("Hype us up", ICON.party, () => { tools.confetti(); tools.banner(`go ${names()}! 🎉`); }));
    else if (modeId === "free") chips.push(chip("Set the mood", ICON.wand, () => { tools.mood("candlelight"); chat.say("ai", "mood: set 🕯️"); }));
    else chips.push(chip("Make it special", ICON.heartFill, () => tools.sweet()));
    if (grabFrame && ai.tier === 3 && ai.see) chips.push(chip("How do we look?", ICON.eye, () => glance(true)));
    chips.push(chip("Surprise us", ICON.shuffle, () => nav("ready", pickMode(modeId))));
    if (!hostOn) chips.push(chip("You host", ICON.crown, () => setHost(true)));
    return chips.slice(0, 3);
  }
  // fire a mode's primary "generate/advance" action if it has one
  function primaryAction(modeId) {
    const acts = getModeActions(modeId) || [];
    const gen = acts.find(([a]) => /^(go|next|begin|new|idea|name|roast|scene|bar|words|ask|add|calc|spin|roll)$/.test(a));
    const pick = gen || acts[0];
    if (pick) modeAction(pick[0]);
  }

  // ---- vision glance: Cupid looks at the call and reacts (server tier only) -
  async function glance(force) {
    if (!grabFrame || !ai.see || ai.tier !== 3) { if (force) chat.say("ai", "hook up the home server and I'll actually look 👀"); return; }
    const t = now(); if (!force && t - lastGlance < 55000) return; lastGlance = t;
    const img = grabFrame(); if (!img) return;
    const fb = rand([`you two look adorable right now 💕`, `mm, I love this energy ✨`]);
    const line = await ai.see({ system: hostSys("You can SEE their video right now — react to what you actually see: faces, expressions, what they're wearing or doing. Warm and specific."), user: "What do you see? React in one playful line.", image: img, max: 70, temp: 0.9 }, () => fb);
    if (line) { chat.say("ai", line.trim()); if (memory) memory.note("saw", line.trim()); }
  }

  // ---- the night arc: advance the act from time + energy + hour ------------
  function advanceAct() {
    const r = room(), t = now();
    const mins = (t - actSince) / 60000, elapsedMin = (r.elapsedMs || 0) / 60000, hour = r.hour != null ? r.hour : 12;
    const late = hour >= 23 || hour < 4;
    let next = act;
    if (act === "warmup" && mins > 3) next = "connect";
    else if (act === "connect" && mins > 4) next = r.energy > 0.5 ? "play" : "connect";
    else if (act === "play" && mins > 6) next = spiceCeil() >= 2 && (r.kiss || r.heart) ? "spice" : "connect";
    else if (act === "spice" && mins > 6) next = "connect";
    if ((late && elapsedMin > 20) || elapsedMin > 75 || (r.zoned && mins > 2)) next = "winddown";
    if (next !== act) { act = next; actSince = t; toneNow(); announceAct(); }
  }
  function announceAct() {
    const line = {
      connect: [`let's slow down and actually talk, ${names()} 💬`, `okay — real-talk time 🫶`],
      play: [`enough sweet talk — let's PLAY 🎮`, `time to get a little competitive 😏`],
      spice: [`mm, it's getting warm in here… want me to turn it up? 🔥`, `feeling brave tonight, ${names()}? 😈`],
      winddown: [`let's wind down, ${names()} 🌙`, `come here — time to get cozy ✨`],
      warmup: [`let's ease in 💫`],
    }[act];
    if (line) chat.say("ai", rand(line));
    if (act === "winddown") setTimeout(() => goodnight(), 20000);
  }

  // ---- autopilot beats (authority only; paced + jittered) ------------------
  function tick() {
    if (!hostOn || switchPending || chat.busy || !isAuthority()) return;   // never interrupt a prompt
    const t = now();
    if (t - lastBeat < 24000) return;
    lastBeat = t + Math.random() * 16000;              // 24–40s cadence
    beats++;
    advanceAct();
    const r = room();
    if (beats % 4 === 0 && ai.tier === 3 && grabFrame && ai.see) return glance(false);  // sometimes just look
    const roll = Math.random();
    if (r.idleMs > 45000 || r.energy < 0.15) { if (roll < 0.5) hostLine(); else proposeSwitch(pickMode(getMode())); }
    else if (roll < 0.38) ambient();
    else if (roll < 0.66) hostLine();
    else proposeSwitch(pickMode(getMode()));
  }
  function ambient() {
    rand([
      () => tools.effect("sparkle"),
      () => tools.confetti(),                            // broadcasts → both screens
      () => { tools.mood(act === "winddown" ? "cozy" : act === "spice" ? "candlelight" : rand(["candlelight", "cozy", "party"])); chat.say("ai", rand(["setting the vibe 🕯️", "mood: adjusted ✨", "there we go 💫"])); },
      () => tools.effect("rainbow"),
      () => tools.sweet(),                               // broadcasts a sweet note
    ])();
  }
  function hostLine() {
    const fb = rand([`you're doing great, ${names()} 💫`, `${names()}, you two are trouble 😏`, `ok this is adorable 💕`, `quick — tell each other one thing you love 💬`, `eye contact… now 👀`]);
    if (ai.available()) ai.ask({ system: hostSys("Keep the night lively with one warm/playful line."), user: `Act: ${act}. Keep it lively.`, max: 36, temp: 1.15 }, () => fb).then((t) => chat.say("ai", (t || fb).trim()));
    else chat.say("ai", fb);
  }
  function proposeSwitch(id) {
    if (!id || !getModeInfo(id) || id === getMode()) return;
    switchPending = true;
    const nm = getModeInfo(id).nm;
    chat.say("ai", rand([`next up — ${nm}! 🎬`, `let's switch it up: ${nm}`, `${names()}, time for ${nm} 💫`]));
    let cancelled = false;
    const go = () => { if (memory) memory.note("play", `played ${nm}`); nav("play", id); };
    chat.actions([
      chip(`Go — ${nm}`, ICON.play, () => { cancelled = true; switchPending = false; go(); }),
      chip("Not yet", ICON.x, () => { cancelled = true; switchPending = false; }),
    ]);
    setTimeout(() => { switchPending = false; if (!cancelled && hostOn && !chat.busy && getMode() !== id) go(); }, 7000);
  }

  // ---- end-of-night recap: summarize tonight into memory -------------------
  async function goodnight() {
    if (recapDone) return; recapDone = true;
    const evs = memory ? memory.recent(12).map((e) => e.text) : [];
    const fb = `A cozy night in with ${names()}${evs.length ? " — " + evs.slice(0, 3).join(", ") : ""}.`;
    let text = fb;
    if (ai.available() && evs.length) text = (await ai.ask({ system: `You are Cupid. In ONE warm sentence, recap tonight for ${names()} so you remember it next time. Past tense, specific, sweet.`, user: `Tonight's moments: ${evs.join("; ")}.`, max: 70, temp: 0.9 }, () => fb)) || fb;
    if (memory) memory.recap((text || fb).trim());
    chat.say("ai", rand([`goodnight, ${names()} — tonight was lovely 🌙`, `sleep well you two 💕 I'll remember tonight`]));
  }

  // ---- make free chat agentic: chips + visual questions + remember ---------
  function afterChat(text) {
    const t = (text || "").toLowerCase(), chips = [];
    if (memory && text && text.length < 120) memory.note("said", text);
    // a visual question → actually look at the call
    if (/(how do (i|we) look|what.*(wear|holding|behind me|in my|do you see)|rate (my|our)|look at (me|us|this))/.test(t)) { glance(true); return; }
    // "draw/paint us …" → conjure a picture via the home image server
    if (tools.image && /((draw|paint|make|generate|show)\b.{0,18}\b(us|me|picture|photo|portrait|image|art|selfie)|(picture|photo|portrait) of us)/.test(t)) { tools.image(text.replace(/^\s*(please\s+)?(draw|paint|make|generate|show)\s+(me\s+|us\s+)?(a\s+)?/i, "").trim() || undefined); return; }
    const addMode = (id) => { const mi = getModeInfo(id); if (mi) chips.push(chip(mi.nm, iconOf(id), () => nav("ready", id))); };
    if (/\bkiss/.test(t)) addMode("kisscam");
    if (/danc/.test(t)) addMode("dancebattle");
    if (/dare|truth/.test(t)) addMode("truthdare");
    if (/\bdice|roll/.test(t)) addMode("loversdice");
    if (/bored|what (can|should|do)|which game|play|fun/.test(t)) chips.push(chip("Pick a game", ICON.shuffle, () => nav("ready", pickMode())));
    if (/mood|romantic|cozy|candle|vibe|dim/.test(t)) chips.push(chip("Set the mood", ICON.wand, () => { tools.mood("candlelight"); }));
    if (/miss|love you|sweet|adore|cute/.test(t)) chips.push(chip("Send a love note", ICON.heartFill, () => tools.sweet()));
    if (chips.length) chat.actions(chips.slice(0, 3));
  }

  return {
    setHost, isOn, intro, tick, afterChat, glance, goodnight,
    setSpice: (n) => memory && memory.setSpice(n),
    get names() { return names(); },
    get act() { return act; },
    get profile() { return memory ? memory.profile : {}; },
  };
}
