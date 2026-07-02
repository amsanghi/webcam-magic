// afterdark.js — After-dark (flirty, never explicit): truth or dare, pick-up lines, dare roulette, lovers' dice, would-you-rather, never have I ever.
import { FX, net, host, authority, meIdx, W, H, MID, toCanvas, rnd, pick, clamp, cursor, cursorPx, activeCur, roundRect, pill, outline, fit, hint, scoreboard, big } from "./_shared.js";

// ---------------- TRUTH OR DARE ------------------------------------------
export function truthDareMode() {
  // flirty deck (suggestive, never explicit)
  const TRUTH_A = ["Where do you most want to be kissed? 😏", "What outfit of mine drives you crazy? 👀", "Describe your ideal cuddle… in detail 🫠", "What's the first thing you'd do if I walked in right now? 😉", "Rate our last kiss 1–10 😘", "Big spoon or little spoon — and why? 😌", "What's something you've been wanting to try with me? 😏", "Where's the first place you'd kiss me? 💋", "What were you thinking last time you looked at me like that? 👀", "What's your favorite thing about how I look right now? 🔥", "Lights on or off? 🌙😏", "What outfit do you secretly want to peel me out of… of the ones you've seen? 👀"];
  const DARE_A = ["Blow a slow kiss 😘", "Bite your lip at the camera 😏", "Whisper something only I'd want to hear 🤫", "Give the camera your most kissable face 💋", "Slow wink + a 'come here' finger 😉", "Trace a slow heart on your lips 💋", "Do your most charming 'miss you' eyes 🥺😏", "Send a 3-second slow-motion kiss 💋", "Give a flirty over-the-shoulder look 😏", "Show me where you'd want my hand right now (keep it classy 😏)", "Undo one button / push up a sleeve 😉", "Strike your most confident pose 🔥"];
  let text = "press truth or dare", kind = "";
  return {
    action(a) {
      if (a !== "truth" && a !== "dare") return;
      kind = a; const isDare = a === "dare";
      host.ai.ask({ user: isDare ? "Give ONE bold, spicy dare for this couple on a video call." : "Give ONE flirty, spicy truth question for this couple.", max: 55, temp: 1.05 }, () => pick(isDare ? DARE_A : TRUTH_A))
        .then((t) => { text = (t || "").trim() || pick(isDare ? DARE_A : TRUTH_A); net.send({ t: "td", kind, text }); if (isDare) FX.flood(0, W, ["🔥"], 14); if (host.chat) host.chat.say("ai", (isDare ? "🔥 " : "💬 ") + text); });
    },
    onNet(m) { if (m.t === "td") { kind = m.kind; text = m.text; FX.flood(0, W, kind === "dare" ? ["🔥"] : ["💬"], 14); } },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, kind === "dare" ? "🔥 DARE" : kind === "truth" ? "💬 TRUTH" : "😈 Truth or Dare", text); },
  };
}


// ---------------- PICKUP / COMPLIMENT ROULETTE ---------------------------
export function pickupMode() {
  const SPICY = ["Is it hot in here, or just you? 🥵", "Come closer to the camera… 😏", "You + me + zero distance = trouble 😈", "These lips look lonely — wanna fix that? 💋", "Stop being so distractingly cute 🔥", "I've got plans for you later 😉", "Wish I could close this distance right now 😩💕", "You have no idea what that smile does to me 🫠", "Keep looking at me like that and I won't behave 😈", "Counting down till I can wrap you up 🤗🔥", "That outfit is doing things to me 👀", "Save that energy for when we're in the same room 😏"];
  let text = "press for a line 💘";
  return {
    action(a) { if (a === "go") { host.ai.ask({ user: "Give ONE bold, flirty pick-up line to send my partner.", max: 45, temp: 1.1 }, () => pick(SPICY)).then((t) => { text = (t || "").trim() || pick(SPICY); net.send({ t: "pickup", text }); FX.flood(0, W, ["💋", "🔥"], 16); FX.Sound.chime(); if (host.chat) host.chat.say("ai", text); }); } },
    onNet(m) { if (m.t === "pickup") { text = m.text; FX.flood(0, W, ["💘"], 14); } },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "💘", text); },
  };
}


// ---------------- DARE ROULETTE (bold dares, spins) ----------------------
export function dareRouletteMode() {
  const D = ["slow-kiss the camera 💋", "bite your lip 😏", "whisper a secret 🤫", "give a 'come here' look 😉", "trace your lips 💋", "best bedroom eyes 😴😏", "undo a button 😉", "strike a sultry pose 🔥", "blow a slow kiss 😘", "peek over your shoulder 😏", "do a slow hair flip 💇", "send your most wanted look 🥵"];
  let phase = "idle", t = 0, idx = 0, shown = "spin for a dare 🌶️";
  const start = (i) => { idx = i; phase = "spin"; t = 1.6; };
  return {
    action(a) { if (a === "spin" && phase !== "spin") { const i = Math.floor(Math.random() * D.length); start(i); net.send({ t: "roul", i }); } },
    onNet(m) { if (m.t === "roul") start(m.i); },
    update(dt) { if (phase === "spin") { t -= dt; if (t <= 0) { shown = D[idx]; phase = "done"; FX.flood(0, W, ["🌶️", "🔥", "💋"], 24); FX.Sound.chime(); } else if (t > 0.2) shown = D[Math.floor(Math.random() * D.length)]; } },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "🌶️ " + shown, phase === "done" ? "do it 😏" : "press spin"); },
  };
}


// ---------------- LOVERS' DICE (action × spot) --------------------------
export function loversDiceMode() {
  const ACT = ["kiss 💋", "blow a kiss to 😘", "nibble 😏", "trace a finger down 👆", "whisper to 🤫", "slow-kiss 💋", "leave a mark on 🔥", "nuzzle 🫠"];
  const SPOT = ["the lips 👄", "the neck 🔥", "a cheek 😊", "the collarbone ✨", "an ear 👂", "a hand ✋", "the forehead 😌", "the jawline 😏"];
  let a = "", s = "", t = 0, phase = "idle";
  return {
    action(x) { if (x === "roll") { a = pick(ACT); s = pick(SPOT); phase = "show"; t = 5; net.send({ t: "dice", a, s }); FX.flood(0, W, ["💋", "🔥"], 16); FX.Sound.chime(); } },
    onNet(m) { if (m.t === "dice") { a = m.a; s = m.s; phase = "show"; t = 5; } },
    update(dt) { if (t > 0) t -= dt; },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.font = "76px serif";
      ctx.fillText("🎲", W / 2 - 70, H / 2 - 100); ctx.fillText("🎲", W / 2 + 70, H / 2 - 100);
      phase === "idle" ? big(ctx, "🎲 Lovers' Dice", "press roll — then act it out 😏") : big(ctx, a + " " + s, "act it out 😏");
    },
  };
}


// ---------------- WOULD YOU RATHER (flirty, finger vote) -----------------
export function wyrMode() {
  const Q = [["cozy night in 🛋️", "wild night out 🎉"], ["little spoon 🥄", "big spoon 🤗"], ["forehead kisses 😌", "neck kisses 🔥"], ["slow dance 💃", "pillow fight 🪶"], ["morning cuddles ☀️", "midnight talks 🌙"], ["lights on 💡", "lights off 🌙"], ["tease 😏", "be teased 🫠"], ["make the first move 😉", "be swept off your feet 🥰"]];
  let q = Q[0], phase = "idle", t = 0, a0 = 0, a1 = 0, res = "", picks = {};
  const start = (i) => {
    q = Q[i]; phase = "count"; t = 6; res = ""; picks = {};
    // tap to vote (fingers still work as the fallback gesture)
    host.choices(q, (k) => { if (authority) picks[0] = k + 1; else net.send({ t: "wyr-p", k: k + 1 }); });
  };
  const finish = (m) => { a0 = m.a0; a1 = m.a1; res = a0 === a1 ? "same taste 💕" : "opposites attract 😏"; if (a0 === a1) FX.flood(0, W, ["💕"], 26); phase = "done"; t = 4; host.choices(null); };
  return {
    action(a) { if (a === "go") { const i = Math.floor(Math.random() * Q.length); start(i); net.send({ t: "wyr", q: i }); } },
    onNet(m) {
      if (m.t === "wyr") start(m.q);
      else if (m.t === "wyr-p" && authority) picks[1] = m.k;
      else if (m.t === "wyr-res") finish(m);
    },
    update(dt, local, remote) {
      if (phase === "count") { t -= dt; if (authority && t <= 0) { const r = { a0: picks[0] || (local && local.fingers >= 2 ? 2 : 1), a1: picks[1] || (remote && remote.fingers >= 2 ? 2 : 1) }; net.send({ t: "wyr-res", ...r }); finish(r); } }
      else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; }
    },
    draw(ctx) {
      if (phase === "idle") big(ctx, "😏 Would You Rather", "press go — then tap your pick (or ☝️/✌️ fingers)");
      else if (phase === "count") { big(ctx, "😏 Would you rather…", `1️⃣ ${q[0]}\n2️⃣ ${q[1]}`); hint(ctx, `tap your answer · ${Math.ceil(Math.max(0, t))}`); }
      else { const mine = meIdx() === 0 ? a0 : a1; big(ctx, "you: " + (mine === 1 ? q[0] : q[1]), res); }
    },
  };
}


// ---------------- NEVER HAVE I EVER (flirty confessions) -----------------
export function neverMode() {
  const N = ["fantasized about our next date 😏", "fallen asleep on call with you 🥱💕", "re-read our old texts 📱", "stared at your photo too long 👀", "wanted to kiss you through the screen 💋", "had a dream about you 😴💕", "gotten butterflies from one text 🦋", "wanted to skip everything just to see you ✈️", "undressed you with my eyes 😳😏", "rehearsed what I'd do when I see you 🫠"];
  const A = ["I have 😳", "I haven't 😇"];
  let text = "", ans = [null, null];
  const fresh = (t) => {
    text = t; ans = [null, null];
    host.choices(A, (k) => { reveal(meIdx(), k); net.send({ t: "nhie", w: meIdx(), k }); });
  };
  const reveal = (w, k) => { ans[w] = k; if (k === 0) FX.confetti(w === 0 ? W * 0.25 : W * 0.75, H * 0.35, 14); };
  return {
    action(a) { if (a === "next") { host.ai.ask({ user: "Complete ONE spicy 'Never have I ever…' confession for a couple (just the part after 'ever').", max: 40, temp: 1.05 }, () => pick(N)).then((t) => { const line = (t || "").trim() || pick(N); fresh(line); net.send({ t: "never", text: line }); FX.flood(0, W, ["🙈", "💕"], 12); }); } },
    onNet(m) { if (m.t === "never") fresh(m.text); else if (m.t === "nhie") reveal(m.w, m.k); },
    draw(ctx) {
      big(ctx, "🙈 Never have I ever…", text || "press next");
      const lbl = (k) => (k == null ? "…" : A[k]);
      hint(ctx, text ? `you: ${lbl(ans[meIdx()])}  ·  partner: ${lbl(ans[1 - meIdx()])}` : "tap next for a confession — then answer honestly 😏");
    },
  };
}

export const modes = {
  "truthdare": { cat: "After dark 🌶️", ic: "😈", nm: "Truth or Dare", how: ["Press truth or dare for a flirty prompt", "Read it out and do it 😏"], actions: [["truth", "💬 truth"], ["dare", "🔥 dare"]], make: truthDareMode },
  "pickup": { cat: "After dark 🌶️", ic: "💘", nm: "Pick-up Lines", how: ["Press for a flirty line / pick-up", "Delivered to your partner too 😘"], actions: [["go", "💘 line"]], make: pickupMode },
  "dareroulette": { cat: "After dark 🌶️", ic: "🌶️", nm: "Dare Roulette", how: ["Spin the wheel of bold dares", "Whatever it lands on… you do 😈"], actions: [["spin", "🌶️ spin"]], make: dareRouletteMode },
  "loversdice": { cat: "After dark 🌶️", ic: "🎲", nm: "Lovers' Dice", how: ["Roll for an action × a spot", "e.g. “slow-kiss the neck” — act it out 😏"], actions: [["roll", "🎲 roll"]], make: loversDiceMode },
  "wyr": { cat: "After dark 🌶️", ic: "😏", nm: "Would You Rather", how: ["A flirty this-or-that appears", "Vote with fingers: ☝️ left, ✌️ right — see if you match"], actions: [["go", "go"]], make: wyrMode },
  "never": { cat: "After dark 🌶️", ic: "🙈", nm: "Never Have I Ever", how: ["A spicy confession appears each round", "Say 'I have' or 'I haven't' 😏"], actions: [["next", "🙈 next"]], make: neverMode },
};
