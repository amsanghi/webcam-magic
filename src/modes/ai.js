// ai.js — modes powered by the on-device LLM (host.ai). Every mode calls
// host.ai.ask(spec, fallback) which ALWAYS resolves to a string: it generates
// on whichever device is the "generator" (your Mac when present), broadcasts
// the text so both screens match, and falls back to the static deck here when
// no capable device is available. So all of these also work at tier 0.
import { FX, net, host, W, H, MID, rnd, pick, big, hint, outline, scoreboard } from "./_shared.js";

// One-line status shown under each AI mode so you know which tier is running.
function aiHint() {
  const ai = host.ai;
  if (!ai || !ai.available()) return "no AI device here — using the classic deck";
  if (ai.amGenerator()) {
    if (ai.status === "ready") return "on-device AI ✨";
    if (ai.status === "loading") return "loading model… " + Math.round((ai.progress || 0) * 100) + "%";
    return "press ⬇AI once to load (~" + (Math.round((ai.approxMB || 0) / 100) / 10) + " GB, then it's cached)";
  }
  return "your partner's device is generating ✨";
}

// Generic "press → get one line" AI mode with a static fallback deck.
function lineMode(cfg) {
  let text = cfg.start || "press ✨", busy = false;
  return {
    action(a) {
      if (a === "load") { host.ai.load(); return; }
      if (a === "go") {
        busy = true;
        host.ai.ask({ system: cfg.sys, user: cfg.user(), max: cfg.max || 60, temp: cfg.temp }, () => pick(cfg.deck))
          .then((t) => { text = (t || "").trim() || pick(cfg.deck); busy = false; net.send({ t: cfg.id, x: text }); if (host.chat) host.chat.say("ai", text); if (cfg.fx) FX.flood(0, W, cfg.fx, 14); });
      }
    },
    onNet(m) { if (m.t === cfg.id) text = m.x; },
    draw(ctx) { big(ctx, cfg.ic + " " + cfg.title, busy ? "✨ thinking…" : text); hint(ctx, aiHint()); },
  };
}

// ---------------- CUPID — shared AI companion ----------------------------
export function cupidMode() {
  // Cupid lives in the chat dock now — just set the scene here. Typing in the
  // input (from any mode, but this is its home) goes straight to the AI.
  return {
    enter() { if (host.chat) host.chat.say("ai", "Hey you two 💕 talk to me right here — a date idea, a dare, a debate settled, a poem, or just flirt. Tap 🎤 to speak, 🔊 to hear me back."); },
    action(a) { if (a === "load") host.ai.load(); },
    draw(ctx) { big(ctx, "💘 Cupid", "chat with me on the left ↙"); hint(ctx, aiHint()); },
  };
}
function wrapText(ctx, t, cx, y, maxW, lh) {
  const words = t.split(" "); let line = "", yy = y;
  for (const w of words) { const test = line + w + " "; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line.trim(), cx, yy); line = w + " "; yy += lh; } else line = test; }
  ctx.fillText(line.trim(), cx, yy);
}

// ---------------- AI GAME MASTER — the LLM drives the app (tool-use) ------
export function gameMasterMode() {
  const SYS = "You are the Game Master of a couple's video-call app. Reply with ONE JSON object only, no prose: {\"say\":\"<short hype line, emoji ok>\",\"action\":\"<effect|mood|banner|game|snap>\",\"arg\":\"<value>\"}. effect∈[confetti,hearts,rainbow,sparkle,shake]; mood∈[candlelight,party,cozy]; game∈[catch,pop,rps,truthdare,kisscam,dancebattle,charades,pop,hockey]; keep it flirty but never explicit.";
  const FB = [{ say: "Kiss cam time! 💋", action: "game", arg: "kisscam" }, { say: "Confetti for you two! 🎉", action: "effect", arg: "confetti" }, { say: "Setting the mood 🕯️", action: "mood", arg: "candlelight" }, { say: "Dance it out! 🕺", action: "game", arg: "dancebattle" }, { say: "Rock paper scissors — loser owes a kiss ✊", action: "game", arg: "rps" }];
  let line = "Press ‘go’ — I'll run the night 🎬", busy = false;
  return {
    action(a) {
      if (a === "load") { host.ai.load(); return; }
      if (a === "go") {
        busy = true;
        host.ai.ask({ system: SYS, user: "Run the next fun beat for the couple.", max: 90, temp: 1.0 }, () => JSON.stringify(pick(FB)))
          .then((raw) => { busy = false; line = runGM(raw); net.send({ t: "gm", raw }); });
      }
    },
    onNet(m) { if (m.t === "gm") line = runGM(m.raw, true); },
    draw(ctx) { big(ctx, "🎬 Game Master", busy ? "✨ thinking…" : line); hint(ctx, aiHint()); },
  };
  function runGM(raw) {
    host.ai.runActions(raw);
    try { const s = raw.indexOf("{"), e = raw.lastIndexOf("}"); const say = JSON.parse(raw.slice(s, e + 1)).say; return say || "let's play! 🎉"; } catch (_) { return "let's play! 🎉"; }
  }
}

// ---------------- AI ADVENTURE — collaborative choose-your-story ----------
export function adventureMode() {
  const FB = ["You're on a rooftop in a city that isn't yours yet. She spots a hidden door… 🚪", "The map leads to a tiny café. The barista slides over a note meant for you two… ☕", "A storm rolls in; you duck under an awning, closer than planned… ⛈️"];
  let story = ["Tap ‘begin’ to start an adventure only the two of you are on…"], busy = false;
  const SYS = "Continue a light, romantic-adventure story for a couple in SECOND person ('you two'). 2-3 sentences, vivid, playful, PG-13, end on a little hook. No explicit content.";
  const step = (seed) => {
    busy = true;
    host.ai.ask({ system: SYS, user: seed, max: 110, temp: 1.0 }, () => pick(FB))
      .then((t) => { story.push((t || "").trim() || pick(FB)); story = story.slice(-4); busy = false; net.send({ t: "adv", s: story }); });
  };
  return {
    action(a) {
      if (a === "load") { host.ai.load(); return; }
      if (a === "begin") { story = []; step("Begin a brand-new short romantic adventure for the couple."); }
      if (a === "next") { step("Continue the story: " + story.join(" ")); }
    },
    onNet(m) { if (m.t === "adv") story = m.s; },
    draw(ctx) {
      ctx.save(); ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      story.slice(-3).forEach((l, i) => { ctx.font = "19px system-ui"; ctx.fillStyle = i === story.slice(-3).length - 1 ? "#fff" : "rgba(255,255,255,.6)"; wrapText(ctx, l, W / 2, 150 + i * 110, W * 0.82, 26); });
      ctx.restore();
      if (busy) big(ctx, "", "✨ weaving…"); hint(ctx, aiHint());
    },
  };
}

// ---------------- MAD LIBS — you give 3 words, AI builds the story --------
export function madLibsMode() {
  let text = "Tap ‘words’ and give me 3 silly words 🤪", busy = false;
  return {
    action(a) {
      if (a === "load") { host.ai.load(); return; }
      if (a === "words") {
        host.ask("Three words (comma separated):").then((w) => {
          if (!w) return; busy = true;
          host.ai.ask({ system: "Write a short, funny 3-4 sentence mad-lib style story for a couple that uses ALL these words prominently. Keep it playful, PG-13.", user: "Words: " + w, max: 140, temp: 1.0 },
            () => `Once upon a time, ${w.split(",")[0] || "a cat"} met ${w.split(",")[1] || "a taco"} and everything smelled like ${w.split(",")[2] || "adventure"}. 💫`)
            .then((t) => { text = (t || "").trim(); busy = false; net.send({ t: "madlib", x: text }); });
        });
      }
    },
    onNet(m) { if (m.t === "madlib") text = m.x; },
    draw(ctx) { ctx.save(); ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "20px system-ui"; wrapText(ctx, busy ? "✨ writing…" : text, W / 2, H * 0.4, W * 0.82, 30); ctx.restore(); hint(ctx, aiHint()); },
  };
}

// ---------------- simple "one line" AI modes ------------------------------
const TRUTH_FB = ["What's a tiny thing I do that you secretly love? 😏", "Where in the world would you kiss me first when we reunite? ✈️💋", "Rate our chemistry 1–10 and defend it 😉"];
const WYR_FB = ["Would you rather: a lazy morning in bed, or a wild day out — with me? 😏", "Would you rather text all day or one hour of video every night? 💕", "Would you rather slow-dance in the kitchen or stargaze on a roof? 🌙"];
const DEEP_FB = ["When did you first feel truly safe with me? 🫶", "What does a perfect ordinary day with me look like?", "What's a fear you've only ever told me?"];
const DATE_FB = ["Cook the same recipe over video and 'dine together' tonight 🍝", "Watch a sunset on call — you narrate yours, I'll narrate mine 🌅", "Museum date: screen-share a virtual gallery and rate the art 🎨"];
const PET_FB = ["moonbeam 🌙", "trouble 😏", "my favorite notification 📱💕", "captain cuddles", "sugarplum"];
const ROAST_FB = ["You're so cute it's honestly a little unfair to everyone else 😤💕", "Warning: dangerously charming and terrible at texting back on time 😏", "Certified heart-throb, expired at replying under an hour 💌"];
const ROLE_FB = ["You're strangers who just locked eyes across a dim jazz bar… make the first move 🎷", "Reunited at an airport after months apart — no words yet, just the run-up 🛬", "You're the tenant; I'm the very distracting new neighbor asking to borrow sugar 😏"];
const RAP_FB = ["My rhymes hit harder than your 6am alarm — you snooze, you lose, now blow me a kiss for the encore 🎤", "You call yourself smooth? You left my heart on read — I'm the headliner, you're the opening act instead 😎"];

export const modes = {
  cupid:      { cat: "AI ✨", ic: "💘", nm: "Cupid (AI)", how: ["Your on-device AI companion — just type in the chat on the left (🎤 to speak, 🔊 to hear replies)", "Ask for date ideas, a dare, settle a debate, a poem — it streams to your partner too", "Press ⬇ AI once to load the model on a capable device"], actions: [["load", "⬇ AI"]], make: cupidMode },
  gamemaster: { cat: "AI ✨", ic: "🎬", nm: "AI Game Master", how: ["The AI runs your night — it picks games, sets the mood, and fires effects", "Press go and let it surprise you both"], actions: [["go", "🎬 go"], ["load", "⬇ AI"]], make: gameMasterMode },
  adventure:  { cat: "AI ✨", ic: "🗺️", nm: "AI Adventure", how: ["A romantic choose-your-story, generated live", "‘begin’ then ‘next’ to keep the tale going together"], actions: [["begin", "▶ begin"], ["next", "➡ next"], ["load", "⬇ AI"]], make: adventureMode },
  madlibs:    { cat: "AI ✨", ic: "🤪", nm: "Mad Libs (AI)", how: ["Give three silly words", "The AI spins them into a goofy little story about you two"], actions: [["words", "✍️ words"], ["load", "⬇ AI"]], make: madLibsMode },
  aitruth:    { cat: "AI ✨", ic: "😈", nm: "AI Truth or Dare", how: ["Endless fresh flirty truths & dares", "Never repeats — generated on-device"], actions: [["go", "😈 go"], ["load", "⬇ AI"]], make: () => lineMode({ id: "aitruth", ic: "😈", title: "AI Truth or Dare", deck: TRUTH_FB, fx: ["🔥", "💋"], temp: 1.0, sys: "Write ONE short flirty truth question OR a cute dare for a couple on a video call. Playful, suggestive is fine, never explicit. Emoji ok.", user: () => (Math.random() < 0.5 ? "Give a flirty truth question." : "Give a cute flirty dare.") }) },
  aiwyr:      { cat: "AI ✨", ic: "😏", nm: "AI Would You Rather", how: ["Fresh flirty this-or-that every time"], actions: [["go", "😏 go"], ["load", "⬇ AI"]], make: () => lineMode({ id: "aiwyr", ic: "😏", title: "Would You Rather", deck: WYR_FB, temp: 1.0, sys: "Write ONE playful, flirty 'Would you rather' for a couple. Two options, never explicit. Emoji ok.", user: () => "Give a flirty would-you-rather." }) },
  aideep:     { cat: "AI ✨", ic: "💬", nm: "AI Deep Talk", how: ["Gentle, meaningful prompts to go deeper", "Great for a slow night in"], actions: [["go", "💬 next"], ["load", "⬇ AI"]], make: () => lineMode({ id: "aideep", ic: "💬", title: "Deep Talk", deck: DEEP_FB, temp: 0.9, sys: "Write ONE warm, meaningful connection question for a committed long-distance couple. Sincere, not cheesy.", user: () => "Give a deep connection question." }) },
  aidate:     { cat: "AI ✨", ic: "🗓️", nm: "AI Date Ideas", how: ["Long-distance date-night ideas, generated fresh", "Ask again for more"], actions: [["go", "🗓️ idea"], ["load", "⬇ AI"]], make: () => lineMode({ id: "aidate", ic: "🗓️", title: "Date Idea", deck: DATE_FB, temp: 1.0, sys: "Suggest ONE creative LONG-DISTANCE date idea a couple can do together over video tonight. One sentence, doable, cute.", user: () => "Give a long-distance date idea." }) },
  petname:    { cat: "AI ✨", ic: "🏷️", nm: "AI Pet Names", how: ["Generate a fresh couple nickname", "Keep the ones you love"], actions: [["go", "🏷️ name"], ["load", "⬇ AI"]], make: () => lineMode({ id: "petname", ic: "🏷️", title: "Pet Name", deck: PET_FB, temp: 1.1, sys: "Invent ONE cute, original pet-name / nickname for someone's partner. Just the name, playful, emoji ok.", user: () => "Give a cute pet name." }) },
  roast:      { cat: "AI ✨", ic: "🔥", nm: "AI Roast & Toast", how: ["A loving little roast (that's secretly a compliment)", "All in good fun 😤"], actions: [["go", "🔥 roast"], ["load", "⬇ AI"]], make: () => lineMode({ id: "roast", ic: "🔥", title: "Roast & Toast", deck: ROAST_FB, temp: 1.1, sys: "Write ONE affectionate teasing 'roast' of someone's partner that lands as a compliment. Playful, warm, never mean or explicit.", user: () => "Roast my partner lovingly." }) },
  roleplay:   { cat: "AI ✨", ic: "🎭", nm: "Roleplay (AI)", how: ["A fresh scene to act out together", "Press for a new scenario, then improvise 😏"], actions: [["go", "🎭 scene"], ["load", "⬇ AI"]], make: () => lineMode({ id: "roleplay", ic: "🎭", title: "Roleplay", deck: ROLE_FB, temp: 1.1, sys: "Write ONE short, immersive roleplay scene setup for a couple to act out over video — a setting + a vibe in 1-2 sentences, flirty, leaving room to improvise.", user: () => "one roleplay scene" }) },
  rapbattle:  { cat: "AI ✨", ic: "🎤", nm: "Rap Battle (AI)", how: ["Trade AI-written bars and perform them 😎", "Press for your next line"], actions: [["go", "🎤 bar"], ["load", "⬇ AI"]], make: () => lineMode({ id: "rapbattle", ic: "🎤", title: "Rap Battle", deck: RAP_FB, temp: 1.15, sys: "Write ONE short playful rap-battle bar (1-2 lines) for a couple teasing each other — cheeky and clever, never actually mean.", user: () => "one playful rap bar" }) },
};
