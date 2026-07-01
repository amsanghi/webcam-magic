// director.js — the AI "host" that actually runs the show.
//
// Turns the AI from a sidebar chatbot into a proactive agent that: greets you in
// every mode, drops one-tap action chips ("open this / do that"), fires ambient
// effects & mood, personalizes with your names, and — in Host mode — takes the
// wheel: it paces the night and auto-switches activities (with a cancel).
//
// It's built on host.ai.ask(spec, fallback) so it stays lively even with NO
// model loaded (curated, name-personalized fallbacks); a real model just makes
// it smarter and custom. Autopilot only drives from the authority to avoid both
// screens fighting; shared beats (confetti, sweet notes, navigation) broadcast.

import { ICON } from "./icons.js";

export function createDirector({ ai, chat, tools, nav, modeAction, getMode, getModeActions, getModeInfo, modeIcon, isAuthority }) {
  let hostOn = false, lastBeat = 0, switchPending = false, greeted = "";
  let profile = {};
  try { profile = JSON.parse(localStorage.getItem("wm_profile") || "{}"); } catch (_) {}
  if (profile.a) ai.setProfile(profile.a, profile.b);

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const rand = (a) => a[Math.floor(Math.random() * a.length)];
  const names = () => (profile.a && profile.b ? `${profile.a} & ${profile.b}` : profile.a ? profile.a : "you two");
  // fun, quick, couple-y modes the host likes to spin up
  const POOL = ["kisscam", "dancebattle", "truthdare", "rps", "pop", "catch", "deeptalk", "telepathy", "thisorthat", "spinner", "wyr", "photobooth", "charades", "pictionary", "loversdice"];
  const chip = (label, icon, run) => ({ label, icon, run });
  const iconOf = (id) => { const mi = getModeInfo(id); return modeIcon(id, mi && mi.cat); };

  // ---- personalization -----------------------------------------------------
  async function ensureNames() {
    if (profile.a) return;
    const v = await chat.ask("Before I host — what should I call you two? (e.g. Alex & Sam)");
    if (!v) return;
    const parts = v.split(/&|,|\band\b|\+/i).map((s) => s.trim()).filter(Boolean);
    profile = { a: parts[0] || "", b: parts[1] || "" };
    try { localStorage.setItem("wm_profile", JSON.stringify(profile)); } catch (_) {}
    ai.setProfile(profile.a, profile.b);
    if (profile.a) chat.say("ai", `Love it — ${names()} it is 💫`);
  }

  // ---- host (autopilot) toggle --------------------------------------------
  async function setHost(on) {
    hostOn = on;
    if (on) {
      await ensureNames();
      chat.say("ai", rand([`Okay ${names()}, I've got the night 🎬`, `Host mode on — sit back, ${names()} ✨`, `Leave it to me, ${names()} 💕`]));
      lastBeat = now();
    } else chat.say("ai", "All yours again — tap me back in whenever ✨");
    return hostOn;
  }
  const isOn = () => hostOn;

  // ---- per-mode intro (runs on entering ANY mode) --------------------------
  function intro(modeId) {
    const mi = getModeInfo(modeId); if (!mi) return;
    greeted = modeId;
    const fb = rand([`${mi.nm} — nice pick, ${names()} 💕`, `Ooh, ${mi.nm}. let's make it fun ✨`, `${mi.nm} it is — I'm right here to help 💫`, `${names()}, ${mi.nm} time 🎬`]);
    const chips = () => { if (greeted === modeId) chat.actions(introChips(modeId, mi.cat || "")); };
    if (ai.available()) {
      ai.ask({ system: `You are Cupid, the warm playful host of a couple's video-call app. In ONE short sentence (<=14 words, emoji ok, no quotes), react to them opening the "${mi.nm}" activity and invite them in.`, user: `They opened ${mi.nm}.`, max: 40, temp: 1.05 }, () => fb)
        .then((t) => { if (greeted === modeId) { chat.say("ai", (t || fb).trim()); chips(); } });
    } else { chat.say("ai", fb); chips(); }
  }
  function introChips(modeId, cat) {
    const chips = [];
    if (cat.includes("Talk") || cat.includes("AI")) chips.push(chip("Fresh one", ICON.sparkles, () => primaryAction(modeId)));
    else if (cat === "Games" || cat.includes("senses")) chips.push(chip("Hype us up", ICON.party, () => { tools.confetti(); tools.banner(`go ${names()}! 🎉`); }));
    else if (modeId === "free") chips.push(chip("Set the mood", ICON.wand, () => { tools.mood("candlelight"); chat.say("ai", "mood: set 🕯️"); }));
    else chips.push(chip("Make it special", ICON.heartFill, () => tools.sweet()));
    chips.push(chip("Surprise us", ICON.shuffle, () => nav("ready", rand(POOL.filter((m) => m !== modeId)))));
    if (!hostOn) chips.push(chip("You host", ICON.sparkles, () => setHost(true)));
    return chips.slice(0, 3);
  }
  // fire a mode's primary "generate/advance" action if it has one
  function primaryAction(modeId) {
    const acts = getModeActions(modeId) || [];
    const gen = acts.find(([a]) => /^(go|next|begin|new|idea|name|roast|scene|bar|words|ask|add)$/.test(a));
    const pick = gen || acts[0];
    if (pick) modeAction(pick[0]);
  }

  // ---- autopilot beats (authority only; paced + jittered) ------------------
  function tick() {
    if (!hostOn || switchPending || chat.busy || !isAuthority()) return;   // never interrupt a prompt
    const t = now();
    if (t - lastBeat < 24000) return;
    lastBeat = t + Math.random() * 16000;              // 24–40s cadence
    const roll = Math.random();
    if (roll < 0.4) ambient();
    else if (roll < 0.68) hostLine();
    else proposeSwitch(rand(POOL.filter((m) => m !== getMode())));
  }
  function ambient() {
    rand([
      () => tools.effect("sparkle"),
      () => { tools.confetti(); },                     // broadcasts → both screens
      () => { tools.mood(rand(["candlelight", "cozy", "party"])); chat.say("ai", rand(["setting the vibe 🕯️", "mood: adjusted ✨", "there we go 💫"])); },
      () => tools.effect("rainbow"),
      () => { tools.sweet(); },                         // broadcasts a sweet note
    ])();
  }
  function hostLine() {
    const fb = rand([`you're doing great, ${names()} 💫`, `${names()}, you two are trouble 😏`, `ok this is adorable 💕`, `quick — tell each other one thing you love 💬`, `eye contact… now 👀`]);
    if (ai.available()) ai.ask({ system: `You are Cupid hosting a couple (${names()}). Say ONE short warm/playful line to keep the night lively. Emoji ok, no quotes, <=14 words.`, user: "keep it lively", max: 36, temp: 1.15 }, () => fb).then((t) => chat.say("ai", (t || fb).trim()));
    else chat.say("ai", fb);
  }
  function proposeSwitch(id) {
    if (!id || !getModeInfo(id)) return;
    switchPending = true;
    const nm = getModeInfo(id).nm;
    chat.say("ai", rand([`next up — ${nm}! 🎬`, `let's switch it up: ${nm}`, `${names()}, time for ${nm} 💫`]));
    let cancelled = false;
    chat.actions([
      chip(`Go — ${nm}`, ICON.play, () => { cancelled = true; switchPending = false; nav("play", id); }),
      chip("Not yet", ICON.x, () => { cancelled = true; switchPending = false; }),
    ]);
    setTimeout(() => { switchPending = false; if (!cancelled && hostOn && !chat.busy && getMode() !== id) nav("play", id); }, 7000);
  }

  // ---- make free chat agentic: attach contextual one-tap chips -------------
  function afterChat(text) {
    const t = (text || "").toLowerCase(), chips = [];
    const addMode = (id) => { const mi = getModeInfo(id); if (mi) chips.push(chip(mi.nm, iconOf(id), () => nav("ready", id))); };
    if (/\bkiss/.test(t)) addMode("kisscam");
    if (/danc/.test(t)) addMode("dancebattle");
    if (/dare|truth/.test(t)) addMode("truthdare");
    if (/\bdice|roll/.test(t)) addMode("loversdice");
    if (/bored|what (can|should|do)|which game|play|fun/.test(t)) chips.push(chip("Pick a game", ICON.shuffle, () => nav("ready", rand(POOL))));
    if (/mood|romantic|cozy|candle|vibe|dim/.test(t)) chips.push(chip("Set the mood", ICON.wand, () => { tools.mood("candlelight"); }));
    if (/miss|love you|sweet|adore|cute/.test(t)) chips.push(chip("Send a love note", ICON.heartFill, () => tools.sweet()));
    if (chips.length) chat.actions(chips.slice(0, 3));
  }

  return { setHost, isOn, intro, tick, afterChat, get names() { return names(); }, get profile() { return profile; } };
}
