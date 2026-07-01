// talk.js — Talk & connect prompts and word games.
import { FX, net, host, authority, meIdx, W, H, MID, toCanvas, rnd, pick, clamp, cursor, cursorPx, activeCur, roundRect, pill, outline, fit, hint, scoreboard, big } from "./_shared.js";


// 💞 36 QUESTIONS (Arthur Aron — "the ones that lead to love")
export function q36Mode() {
  const Q = ["Given the choice of anyone in the world, whom would you want as a dinner guest?", "Would you like to be famous? In what way?", "Before making a phone call, do you ever rehearse what you'll say? Why?", "What would constitute a “perfect” day for you?", "When did you last sing to yourself? To someone else?", "If you could live to 90 keeping the mind or body of a 30-year-old for the last 60 years — which?", "Do you have a secret hunch about how you'll die?", "Name three things you and I appear to have in common.", "For what in your life do you feel most grateful?", "If you could change anything about how you were raised, what would it be?", "Take 4 minutes to tell your partner your life story in as much detail as possible.", "If you could wake up tomorrow having gained one quality or ability, what would it be?", "If a crystal ball could tell you the truth about anything, what would you want to know?", "Is there something you've dreamt of doing for a long time? Why haven't you?", "What is the greatest accomplishment of your life?", "What do you value most in a friendship?", "What is your most treasured memory?", "What is your most terrible memory?", "If you knew you'd die in a year, would you change how you live? Why?", "What does friendship mean to you?", "What roles do love and affection play in your life?", "Alternate sharing something you consider a positive characteristic of your partner (5 total).", "How close and warm is your family? Was your childhood happier than others'?", "How do you feel about your relationship with your mother?", "Make three true “we” statements (e.g. “We are both in this room feeling…”).", "Complete this sentence: “I wish I had someone with whom I could share…”", "If you were to become close friends, what's important for them to know?", "Tell your partner what you like about them — be honest, say things you wouldn't to a stranger.", "Share an embarrassing moment in your life.", "When did you last cry in front of another person? By yourself?", "Tell your partner something you already like about them.", "What, if anything, is too serious to be joked about?", "If you died this evening with no chance to communicate, what would you most regret not telling someone?", "Your house is on fire. After loved ones & pets, you can save one item — what, and why?", "Of all the people in your family, whose death would you find most disturbing? Why?", "Share a personal problem and ask your partner how they'd handle it."];
  let i = 0;
  return {
    onNet(m) { if (m.t === "q36") i = m.i; },
    action(a) { if (a === "next") { i = Math.min(Q.length - 1, i + 1); net.send({ t: "q36", i }); } else if (a === "prev") { i = Math.max(0, i - 1); net.send({ t: "q36", i }); } },
    draw(ctx) { const set = i < 12 ? "Set I" : i < 24 ? "Set II" : "Set III"; big(ctx, Q[i], `36 Questions • ${set} • ${i + 1}/36`); hint(ctx, "take turns answering honestly • ◀ ▶ to move • finish with 4 min of eye contact 👀"); },
  };
}


// 💬 DEEP TALK — lighter connection prompts
export function deepTalkMode() {
  const Q = ["What made you smile today?", "What's a small thing I do that you love?", "Describe our perfect lazy Sunday.", "What are you most looking forward to about seeing me?", "What's a memory of us you replay often?", "If we could teleport anywhere right now, where?", "What's something new you want us to try together?", "What did you first find attractive about me?", "What song reminds you of me?", "What are you grateful for right now?", "How can I support you better this week?", "What's a dream you haven't told me yet?", "What would our ideal date night look like tonight?", "What's your favorite thing about us?", "What's a tiny win you had recently?", "What do you need more of from me?"];
  let text = "press next 💬";
  return {
    onNet(m) { if (m.t === "dt") text = m.text; },
    action(a) { if (a === "next") { text = pick(Q); net.send({ t: "dt", text }); FX.flood(0, W, ["💬", "💕"], 10); } },
    draw(ctx) { big(ctx, "💬", text); hint(ctx, "“next” for a new question — take turns answering"); },
  };
}


// 🙋 20 QUESTIONS — one thinks of something, the other asks yes/no
export function twentyQMode() {
  let count = 0, asker = 1;
  return {
    onNet(m) { if (m.t === "tq") { count = m.c; asker = m.a; } },
    action(a) { if (a === "ask") { count = Math.min(20, count + 1); net.send({ t: "tq", c: count, a: asker }); } else if (a === "swap") { asker = asker ? 0 : 1; count = 0; net.send({ t: "tq", c: count, a: asker }); } else if (a === "reset") { count = 0; net.send({ t: "tq", c: count, a: asker }); } },
    draw(ctx) { const iAsk = asker === meIdx(); big(ctx, count + " / 20", iAsk ? "you ask the yes/no questions" : "think of something — they'll guess!"); hint(ctx, "“asked” after each question • “swap” to switch roles"); },
  };
}


// 🕵️ TWO TRUTHS & A LIE
export function twoTruthsMode() {
  let lines = [], lie = -1, revealed = false;
  return {
    enter() { lines = []; lie = -1; revealed = false; },
    async action(a) {
      if (a === "enter") { const v = await host.ask("Two truths and a lie — 3 lines, put your LIE on the LAST line:", { multiline: true }); if (v) { const L = v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3); if (L.length === 3) { const order = [0, 1, 2].sort(() => Math.random() - 0.5); lie = order.indexOf(2); lines = order.map((k) => L[k]); revealed = false; net.send({ t: "tt", lines, lie }); } } }
      else if (a === "reveal") { revealed = true; net.send({ t: "tt-rev" }); }
    },
    onNet(m) { if (m.t === "tt") { lines = m.lines; lie = m.lie; revealed = false; } else if (m.t === "tt-rev") revealed = true; },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      if (!lines.length) return big(ctx, "🕵️ Two Truths & a Lie", "press “enter” to write yours");
      outline(ctx, "🕵️ Which one is the lie?", W / 2, H * 0.26, 26);
      lines.forEach((l, i) => { ctx.font = "22px system-ui"; ctx.fillStyle = revealed && i === lie ? "#ff8a8a" : "#fff"; ctx.textBaseline = "middle"; ctx.fillText(`${i + 1}.  ${l.slice(0, 46)}${revealed && i === lie ? "   ← the lie" : ""}`, W / 2, H * 0.42 + i * 44); });
      hint(ctx, revealed ? "revealed! “enter” for a new round" : "guess out loud, then “reveal”");
    },
  };
}


// 📖 STORY BUILDER — alternate a sentence each
export function storyMode() {
  let lines = [];
  return {
    enter() { lines = []; },
    async action(a) { if (a === "add") { const v = await host.ask("Add the next sentence to your story:"); if (v) { lines.push(v.trim()); net.send({ t: "st-add", lines }); } } else if (a === "clear") { lines = []; net.send({ t: "st-add", lines }); } },
    onNet(m) { if (m.t === "st-add") lines = m.lines || []; },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; outline(ctx, "📖 Our Story", W / 2, 60, 26);
      if (!lines.length) { ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "20px system-ui"; ctx.fillText("take turns — “add” a sentence each ✍️", W / 2, H / 2); return; }
      const show = lines.slice(-8); ctx.font = "20px system-ui";
      show.forEach((l, i) => { ctx.fillStyle = (lines.length - show.length + i) % 2 ? "#ffd2e0" : "#cfe0ff"; ctx.fillText(l.slice(0, 72), W / 2, 108 + i * 40); });
      hint(ctx, "alternate turns • “add” a sentence to keep it going");
    },
  };
}


// 🧠 TELEPATHY — both name the same thing in a category
export function telepathyMode() {
  const CATS = ["a fruit 🍓", "a color 🎨", "a movie 🎬", "a place to travel ✈️", "an animal 🐾", "a date idea 💕", "a pizza topping 🍕", "a song 🎵", "a number 1–10 🔢", "a weekend plan 🌤️"];
  let cat = "", mine = "", theirs = "", phase = "idle";
  const check = () => { if (mine && theirs) { phase = "reveal"; if (mine.toLowerCase() === theirs.toLowerCase()) { FX.flood(0, W, ["🎉", "💕", "✨"], 40); FX.Sound.chime(); } } };
  const start = (c) => { cat = c; mine = ""; theirs = ""; phase = "answer"; };
  return {
    onNet(m) { if (m.t === "tele-go") start(m.c); else if (m.t === "tele-ans") { theirs = m.w; check(); } },
    async action(a) { if (a === "go") { const c = pick(CATS); start(c); net.send({ t: "tele-go", c }); } else if (a === "answer") { if (phase !== "answer") return; const v = await host.ask("Think alike! Name " + cat + ":"); if (v) { mine = v.trim(); net.send({ t: "tele-ans", w: mine }); check(); } } },
    draw(ctx) {
      if (phase === "idle") return big(ctx, "🧠 Telepathy", "press “new”, then both name the same thing");
      if (phase === "reveal") { const match = mine.toLowerCase() === theirs.toLowerCase(); big(ctx, `${mine || "?"}  •  ${theirs || "?"}`, match ? "🎉 telepathy! you matched" : "😜 not this time — “new” to retry"); }
      else big(ctx, "Name: " + cat, mine ? "waiting for partner…" : "press “answer” to lock it in");
    },
  };
}


// 🤔 HOW WELL DO YOU KNOW ME — one answers truth, the other guesses
export function howWellMode() {
  const Q = ["my favorite food?", "my dream vacation?", "my biggest fear?", "my comfort movie?", "my go-to karaoke song?", "my ideal Sunday?", "my hidden talent?", "the best gift I could get?", "my favorite thing about you?", "my most-used emoji?"];
  let q = "", truth = "", guess = "", phase = "idle", answerer = 0;
  const check = () => { if (truth && guess) phase = "reveal"; };
  return {
    onNet(m) { if (m.t === "hw-go") { q = m.q; answerer = m.an; truth = ""; guess = ""; phase = "play"; } else if (m.t === "hw-truth") { truth = m.v; check(); } else if (m.t === "hw-guess") { guess = m.v; check(); } },
    async action(a) {
      if (a === "go") { q = pick(Q); answerer = meIdx(); truth = ""; guess = ""; phase = "play"; net.send({ t: "hw-go", q, an: answerer }); }
      else if (a === "answer") { if (phase !== "play") return; if (meIdx() === answerer) { const v = await host.ask("(secret) Your true answer — " + q); if (v) { truth = v.trim(); net.send({ t: "hw-truth", v: truth }); check(); } } else { const v = await host.ask("Guess their answer — " + q); if (v) { guess = v.trim(); net.send({ t: "hw-guess", v: guess }); check(); } } }
    },
    draw(ctx) {
      if (phase === "idle") return big(ctx, "🤔 How Well Do You Know Me", "press “new”, then both press “answer”");
      if (phase === "reveal") { const match = truth.toLowerCase() === guess.toLowerCase(); return big(ctx, `truth: ${truth}   guess: ${guess}`, match ? "spot on! 💞" : "close? talk it out 😄"); }
      big(ctx, q, meIdx() === answerer ? "you answer truthfully (secret)" : "you guess their answer");
    },
  };
}


// ⚖️ WHO'S MORE LIKELY — both vote ☝️you / ✌️me
export function whoMoreMode() {
  const Q = ["to text first 📱", "to cry at a movie 😭", "to burn dinner 🔥", "to fall asleep first 😴", "to plan the trip ✈️", "to win an argument 😤", "to forget an anniversary 🙈", "to say “I love you” more 💕", "to be late ⏰", "to start a food fight 🍝", "to send memes at 2am 😂", "to give the better massage 💆"];
  let q = "", phase = "idle", t = 0, mine = 0, theirs = 0;
  const start = (x) => { q = x; phase = "count"; t = 4; mine = 0; theirs = 0; };
  return {
    onNet(m) { if (m.t === "wm") start(m.q); },
    action(a) { if (a === "go") { const x = pick(Q); start(x); net.send({ t: "wm", q: x }); } },
    update(dt, local, remote) {
      if (!authority) return;
      if (phase === "count") { t -= dt; if (t <= 0) { mine = local && local.fingers >= 2 ? 2 : 1; theirs = remote && remote.fingers >= 2 ? 2 : 1; phase = "done"; t = 4; } }
      else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; }
    },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      if (phase === "idle") return big(ctx, "⚖️ Who's More Likely…", "press “go” • vote ☝️ you / ✌️ me");
      if (phase === "count") { outline(ctx, "Who's more likely " + q, W / 2, H * 0.4, 26); pill(ctx, "vote ☝️you / ✌️me • " + Math.ceil(t), W / 2, H * 0.56, 16); return; }
      const agree = mine !== theirs ? "you agree! 😄" : "you disagree — debate! 😆";  // opposite finger picks = same person
      big(ctx, "Who's more likely " + q, agree);
    },
  };
}


// 🔀 THIS OR THAT — quick preference match (☝️ / ✌️)
export function thisOrThatMode() {
  const P = [["☕ coffee", "🍵 tea"], ["🌊 beach", "⛰️ mountains"], ["🐶 dogs", "🐱 cats"], ["🌅 early bird", "🦉 night owl"], ["🍕 pizza", "🌮 tacos"], ["🎬 movie in", "🍸 night out"], ["📱 text", "📞 call"], ["🍫 sweet", "🧂 salty"], ["🏖️ summer", "❄️ winter"], ["🎧 music", "🎙️ podcasts"]];
  let p = null, phase = "idle", t = 0, mine = 0, theirs = 0, streak = 0;
  const start = (x) => { p = x; phase = "count"; t = 3; mine = 0; theirs = 0; };
  return {
    onNet(m) { if (m.t === "tot") { p = P[m.i]; start(P[m.i]); } },
    action(a) { if (a === "go") { const i = Math.floor(Math.random() * P.length); start(P[i]); net.send({ t: "tot", i }); } },
    update(dt, local, remote) {
      if (!authority) return;
      if (phase === "count") { t -= dt; if (t <= 0) { mine = local && local.fingers >= 2 ? 2 : 1; theirs = remote && remote.fingers >= 2 ? 2 : 1; if (mine === theirs) streak++; else streak = 0; phase = "done"; t = 3; } }
      else if (phase === "done") { t -= dt; if (t <= 0) phase = "idle"; }
    },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      if (!p) return big(ctx, "🔀 This or That", "press “go” • ☝️ left / ✌️ right");
      if (phase === "count") { outline(ctx, `☝️ ${p[0]}   vs   ✌️ ${p[1]}`, W / 2, H * 0.42, 26); pill(ctx, "pick! • " + Math.ceil(t), W / 2, H * 0.56, 16); return; }
      const match = mine === theirs;
      big(ctx, match ? "match! 💕" : "opposites 😜", `you: ${mine === 1 ? p[0] : p[1]} • match streak ${streak}`);
    },
  };
}


// 🔡 HANGMAN — one sets a word, the other guesses letters
export function hangmanMode() {
  let word = "", guessed = [], wrong = 0, setter = 0, phase = "idle";
  const masked = () => word.split("").map((c) => c === " " ? "  " : (guessed.includes(c) ? c : "_")).join(" ");
  return {
    onNet(m) { if (m.t === "hm-word") { word = m.w; guessed = []; wrong = 0; setter = m.s; phase = "play"; } else if (m.t === "hm-g") { guessed = m.g; wrong = m.wr; if (word && word.split("").every((c) => c === " " || guessed.includes(c))) phase = "win"; if (wrong >= 6) phase = "lose"; } },
    async action(a) {
      if (a === "set") { const v = await host.ask("Set a secret word or short phrase:"); if (v) { word = v.toLowerCase().trim(); guessed = []; wrong = 0; setter = meIdx(); phase = "play"; net.send({ t: "hm-word", w: word, s: setter }); } }
      else if (a === "guess") { if (phase !== "play" || meIdx() === setter) return; const v = await host.ask("Guess a letter:"); if (v) { const c = v.toLowerCase().trim()[0]; if (c && !guessed.includes(c)) { guessed.push(c); if (!word.includes(c)) wrong++; net.send({ t: "hm-g", g: guessed, wr: wrong }); if (word.split("").every((x) => x === " " || guessed.includes(x))) { phase = "win"; FX.confetti(W / 2, H / 2, 30); } else if (wrong >= 6) phase = "lose"; } } }
    },
    draw(ctx) {
      if (phase === "idle") return big(ctx, "🔡 Hangman", "one presses “set”, the other “guess”");
      if (meIdx() === setter && phase === "play") return big(ctx, "🤫 you set the word", "your partner is guessing…");
      const hearts = "❤️".repeat(Math.max(0, 6 - wrong)) + "🖤".repeat(Math.min(6, wrong));
      big(ctx, phase === "win" ? "solved! 🎉 " + word : phase === "lose" ? "out of tries 😅 " + word : masked(), phase === "play" ? "guesses left: " + hearts : "“set” a new word");
    },
  };
}

export const modes = {
  "q36": { cat: "Talk & connect 💬", ic: "💞", nm: "36 Questions", how: ["The famous set that “leads to love” (Arthur Aron)", "Take turns answering honestly • end with 4 min eye contact 👀"], actions: [["prev", "◀"], ["next", "▶"]], make: q36Mode },
  "deeptalk": { cat: "Talk & connect 💬", ic: "💬", nm: "Deep Talk", how: ["A gentle connection prompt each time", "Take turns answering"], actions: [["next", "💬 next"]], make: deepTalkMode },
  "twentyq": { cat: "Talk & connect 💬", ic: "🙋", nm: "20 Questions", how: ["One of you thinks of something", "The other asks up to 20 yes/no questions to guess it"], actions: [["ask", "➕ asked"], ["swap", "🔄 swap"], ["reset", "↺"]], make: twentyQMode },
  "twotruths": { cat: "Talk & connect 💬", ic: "🕵️", nm: "Two Truths & a Lie", how: ["Write two truths and a lie about yourself", "Partner guesses which is the lie"], actions: [["enter", "✍️ enter"], ["reveal", "👀 reveal"]], make: twoTruthsMode },
  "story": { cat: "Talk & connect 💬", ic: "📖", nm: "Story Builder", how: ["Build a silly story together", "Take turns adding one sentence each"], actions: [["add", "✍️ add"], ["clear", "🗑"]], make: storyMode },
  "telepathy": { cat: "Talk & connect 💬", ic: "🧠", nm: "Telepathy", how: ["A category appears — both name the same thing", "Match = you're on the same wavelength 🎉"], actions: [["go", "🧠 new"], ["answer", "✍️ answer"]], make: telepathyMode },
  "howwell": { cat: "Talk & connect 💬", ic: "🤔", nm: "How Well Do You Know Me", how: ["One answers a question about themselves (secret)", "The other guesses — see if you match"], actions: [["go", "🤔 new"], ["answer", "✍️ answer"]], make: howWellMode },
  "whomore": { cat: "Talk & connect 💬", ic: "⚖️", nm: "Who's More Likely", how: ["A cheeky prompt appears", "Both vote ☝️ you / ✌️ me — agree or debate 😆"], actions: [["go", "⚖️ go"]], make: whoMoreMode },
  "thisorthat": { cat: "Talk & connect 💬", ic: "🔀", nm: "This or That", how: ["Quick-fire preferences", "Pick ☝️ left / ✌️ right — build a match streak"], actions: [["go", "🔀 go"]], make: thisOrThatMode },
  "hangman": { cat: "Talk & connect 💬", ic: "🔡", nm: "Hangman", how: ["One sets a secret word", "The other guesses letters before the hearts run out"], actions: [["set", "🔡 set word"], ["guess", "🔠 guess"]], make: hangmanMode },
};
