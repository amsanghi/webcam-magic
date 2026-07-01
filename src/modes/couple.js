// couple.js — Couple modes: kiss cam, name mash, love calc, date spinner, pictionary, mailbox, bucket list, dress-up, make a wish, hands up, love tap.
import { FX, net, host, authority, meIdx, W, H, MID, toCanvas, rnd, pick, clamp, cursor, cursorPx, activeCur, roundRect, pill, outline, fit, hint, scoreboard, big } from "./_shared.js";


// ---------------- KISS CAM -----------------------------------------------
export function kissCamMode() {
  let phase = "idle", t = 0, success = false;
  return {
    action(a) { if (a === "start") { phase = "count"; t = 3; success = false; net.send({ t: "kisscam" }); } },
    onNet(m) { if (m.t === "kisscam") { phase = "count"; t = 3; success = false; } },
    update(dt, local, remote) {
      if (phase === "count") { t -= dt; if (t <= 0) { phase = "kiss"; t = 4; } }
      else if (phase === "kiss") { t -= dt; const solo = !(remote && remote.present); const mk = local && local.face && local.face.kiss > 0.4, rk = remote && remote.face && remote.face.kiss > 0.4; if ((solo ? mk : mk && rk) && !success) { success = true; FX.flood(0, W, ["💋", "❤️", "💕"], 80, true); FX.burst(W / 2, H / 2, ["💋"], 30, 400); FX.Sound.chime(); } if (t <= 0) phase = "idle"; }
    },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; if (phase === "idle") big(ctx, "💋 Kiss Cam", "press start — then pucker up!"); else if (phase === "count") big(ctx, Math.ceil(t) + "", "get ready to kiss…"); else big(ctx, success ? "awww 😘💕" : "KISS! 💋", success ? "" : "pucker up!"); },
  };
}


// ---------------- COUPLE-NAME MASHUP -------------------------------------
export function mashupMode() {
  let a = "", b = "", out = "press mash 💞";
  const half = (s, front) => front ? s.slice(0, Math.ceil(s.length / 2)) : s.slice(Math.floor(s.length / 2));
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "?";
  return {
    async action(act) {
      if (act !== "go") return;
      if (!a || !b) { const v = await host.ask("Your two names (comma separated):"); if (v) { const p = v.split(","); a = (p[0] || "").trim(); b = (p[1] || "").trim(); } }
      if (a && b) { out = cap(pick([half(a, 1) + half(b, 0), half(b, 1) + half(a, 0), half(a, 1) + half(b, 1)])); net.send({ t: "mash", text: out }); FX.confetti(W / 2, H / 2, 30); FX.Sound.chime(); }
    },
    onNet(m) { if (m.t === "mash") { out = m.text; FX.confetti(W / 2, H / 2, 30); } },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "💞 " + out, "your couple name"); },
  };
}


// ---------------- LOVE CALCULATOR ----------------------------------------
export function loveCalcMode() {
  const V = ["soulmates 💞", "written in the stars ✨", "a perfect match 💕", "made for each other 🥰", "the cutest couple 😍", "endgame 💍"];
  let pct = null, verdict = "";
  return {
    async action(a) { if (a === "calc") { const v = await host.ask("Two names (comma separated):"); if (v) { let h = 0; for (const ch of v.toLowerCase().replace(/[^a-z]/g, "")) h = (h * 31 + ch.charCodeAt(0)) % 1000; pct = 75 + h % 26; verdict = pick(V); net.send({ t: "lovecalc", pct, verdict }); FX.flood(0, W, ["❤️", "💕"], 30); FX.Sound.chime(); } } },
    onNet(m) { if (m.t === "lovecalc") { pct = m.pct; verdict = m.verdict; } },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; pct == null ? big(ctx, "❤️ Love Calculator", "press “calc” + enter both names") : big(ctx, pct + "% 💘", verdict); },
  };
}


// ---------------- DATE SPINNER -------------------------------------------
export function spinnerMode() {
  const IDEAS = ["cook together 🍳", "stargaze 🌌", "play 20 questions ❓", "watch a movie 🎬", "dance 💃", "order the same food 🍜", "draw each other ✏️", "plan a trip ✈️", "karaoke 🎤", "truth or dare 😈", "make a playlist 🎧", "bake something 🧁"];
  let phase = "idle", t = 0, result = "", shown = "spin for a date idea";
  return {
    action(a) { if (a === "spin" && phase !== "spin") { phase = "spin"; t = 1.6; result = ""; host.ai.ask({ user: "Suggest ONE creative long-distance date-night idea a couple can do over video tonight. A few words, emoji ok.", max: 24, temp: 1.1 }, () => pick(IDEAS)).then((r) => { result = (r || "").trim() || pick(IDEAS); net.send({ t: "spin", text: result }); }); } },
    onNet(m) { if (m.t === "spin") { phase = "spin"; t = 1.6; result = m.text; } },
    update(dt) { if (phase === "spin") { t -= dt; if (t <= 0) { shown = result || pick(IDEAS); phase = "done"; FX.flood(0, W, ["🎉", "💕"], 30); FX.Sound.chime(); if (host.chat && result) host.chat.say("ai", "🎡 " + shown); } else if (t > 0.2) shown = pick(IDEAS); } },
    draw(ctx) { ctx.textAlign = "center"; ctx.fillStyle = "#fff"; big(ctx, "🎡 " + shown, phase === "done" ? "go do it! 💞" : "press spin"); },
  };
}


// ---------------- PICTIONARY (one draws, both say it out loud) -----------
export function pictionaryMode() {
  const WORDS = ["cat", "pizza", "heart", "house", "sun", "star", "fish", "tree", "car", "flower", "moon", "cake", "boat", "dog", "robot", "banana", "guitar", "ghost"];
  let strokes = [], cur = { 0: null, 1: null }, isDrawer = false, word = "", revealed = false, score = 0, flash = "";
  const add = (side, pt) => { let c = cur[side]; if (!c) { c = { side, pts: [] }; strokes.push(c); cur[side] = c; } c.pts.push(pt); };
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
  return {
    enter() { strokes = []; cur = { 0: null, 1: null }; isDrawer = false; word = ""; revealed = false; score = 0; },
    async action(a) {
      if (a === "word") { isDrawer = true; word = pick(WORDS); revealed = false; strokes = []; net.send({ t: "pic-role" }); net.send({ t: "draw-clear" }); }
      else if (a === "reveal") { revealed = true; net.send({ t: "pic-reveal", w: word }); }
      else if (a === "clear") { strokes = []; net.send({ t: "draw-clear" }); }
      else if (a === "guess") { if (isDrawer) return; const g = await host.ask("Your guess:"); if (g) net.send({ t: "pic-guess", g }); }
    },
    onNet(m) {
      if (m.t === "pic-role") { isDrawer = false; word = ""; revealed = false; }
      else if (m.t === "pic-reveal") { word = m.w; revealed = true; }
      else if (m.t === "draw") add(1, { x: m.x, y: m.y });
      else if (m.t === "draw-up") cur[1] = null;
      else if (m.t === "draw-clear") strokes = [];
      else if (m.t === "pic-guess" && isDrawer) { if (norm(m.g) === norm(word)) { revealed = true; score++; net.send({ t: "pic-correct", w: word }); FX.confetti(W / 2, H / 2, 40); FX.Sound.chime(); } else { flash = "❌ “" + m.g + "”"; net.send({ t: "pic-wrong", g: m.g }); } }
      else if (m.t === "pic-correct") { word = m.w; revealed = true; score++; FX.confetti(W / 2, H / 2, 40); FX.Sound.chime(); }
      else if (m.t === "pic-wrong") flash = "❌ " + m.g;
    },
    update(dt, local) { if (isDrawer && local && local.pinch && local.pinch.active) { const pt = { x: local.pinch.x, y: local.pinch.y }; add(0, pt); net.send({ t: "draw", x: pt.x, y: pt.y }); } else if (cur[0]) { cur[0] = null; net.send({ t: "draw-up" }); } },
    draw(ctx) {
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 6;
      for (const st of strokes) { if (st.pts.length < 2) continue; ctx.beginPath(); st.pts.forEach((p, i) => { const c = toCanvas(p, st.side); i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y); }); ctx.stroke(); }
      ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "22px system-ui";
      ctx.fillText(isDrawer && !revealed ? "✏️ draw: " + word + "  (don't say it!)" : revealed ? "it was: " + word + " 🎉" : "🤔 guess what they're drawing!", W / 2, 40);
      ctx.font = "16px system-ui"; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillText("✅ score " + score + (flash ? "   " + flash : ""), W / 2, 66);
      hint(ctx, "Pictionary — drawer: “new word” + pinch to draw • guesser: “guess” (or just say it out loud)");
    },
  };
}


// ---------------- LOVE MAILBOX (synced notes, saved to inbox) -------------
export function mailboxMode() {
  const load = () => { try { return JSON.parse(localStorage.getItem("wm_inbox") || "[]"); } catch (_) { return []; } };
  const save = (a) => { try { localStorage.setItem("wm_inbox", JSON.stringify(a.slice(-20))); } catch (_) {} };
  let inbox = [];
  return {
    enter() { inbox = load(); },
    async action(a) { if (a === "write") { const v = await host.ask("Write a love note for your partner:", { multiline: true }); if (v) { net.send({ t: "letter", text: v }); FX.travel({ x: W * 0.25, y: H * 0.5 }, () => ({ x: W, y: H * 0.4 }), "💌"); FX.banner(W / 2, H * 0.3, "sent 💌"); FX.Sound.chime(); } } },
    onNet(m) { if (m.t === "letter") { inbox.push({ text: m.text }); save(inbox); FX.travel({ x: 0, y: H * 0.4 }, () => ({ x: W * 0.25, y: H * 0.5 }), "💌", () => { FX.banner(W / 2, H * 0.3, "💌 new note!"); FX.flood(0, W, ["💕"], 14); }); FX.Sound.chime(); } },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "22px system-ui"; ctx.fillText("💌 Love Mailbox — “write” to send a note", W / 2, 48);
      const recent = inbox.slice(-6);
      if (!recent.length) { ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.fillText("notes from your partner appear here 💕", W / 2, H / 2); return; }
      ctx.textAlign = "left"; ctx.font = "19px system-ui";
      recent.forEach((n, i) => { ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillText("💗 " + String(n.text).slice(0, 56), W * 0.16, 110 + i * 42); });
    },
  };
}


// ---------------- BUCKET LIST (shared, pinch to check off) ---------------
export function bucketMode() {
  let items = [], down = false;
  const load = () => { try { return JSON.parse(localStorage.getItem("wm_bucket") || "[]"); } catch (_) { return []; } };
  const save = () => { try { localStorage.setItem("wm_bucket", JSON.stringify(items)); } catch (_) {} };
  const rowY = (i) => 120 + i * 46;
  return {
    enter() { items = load(); },
    async action(a) { if (a === "add") { const v = await host.ask("Add something to do together:"); if (v) { items.push({ t: v, done: false }); save(); net.send({ t: "bucket", items }); } } else if (a === "clear") { items = []; save(); net.send({ t: "bucket", items }); } },
    onNet(m) { if (m.t === "bucket") { items = m.items || []; save(); } },
    update(dt, local) {
      const d = local && local.pinch && local.pinch.active;
      if (d && !down) { const p = toCanvas(local.pinch, 0); items.forEach((it, i) => { if (Math.abs(p.y - rowY(i)) < 22 && p.x > W * 0.1 && p.x < W * 0.75) { it.done = !it.done; save(); net.send({ t: "bucket", items }); FX.Sound.pop(); if (it.done) FX.sparkleAt(p.x, p.y, 6); } }); }
      down = d;
    },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "24px system-ui"; ctx.fillText("🪣 Our Bucket List", W / 2, 64);
      if (!items.length) { ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "20px system-ui"; ctx.fillText("press “add” to dream up things to do together 💫", W / 2, H / 2); return; }
      ctx.textAlign = "left"; ctx.font = "22px system-ui";
      items.forEach((it, i) => { ctx.fillStyle = it.done ? "rgba(150,255,170,.95)" : "#fff"; ctx.fillText((it.done ? "✅ " : "⬜ ") + String(it.t).slice(0, 48), W * 0.16, rowY(i)); });
      hint(ctx, "Bucket List — “add” items • pinch an item to check it off (synced)");
    },
  };
}


// ---------------- DRESS-UP (matching hats -> twinning) -------------------
export function dressUpMode() {
  const HATS = ["🎩", "👑", "🧢", "🎓", "👒", "🪖", "🎀", "😎", "🤠", "👓", "🍄", "🐱"];
  let mine = -1, theirs = -1, twin = false, lastLocal = null, lastRemote = null;
  const drawHat = (ctx, g, side, idx) => {
    if (!g || !g.face || !g.face.nose || idx < 0) return;
    const n = toCanvas(g.face.nose, side), gl = HATS[idx] === "😎" || HATS[idx] === "👓";
    ctx.save(); ctx.font = "84px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(HATS[idx], n.x, n.y + (gl ? -18 : -150)); ctx.restore();
  };
  return {
    enter() { mine = theirs = -1; twin = false; },
    action(a) { if (a === "next") { mine = (mine + 1) % HATS.length; net.send({ t: "hat", i: mine }); } if (a === "off") { mine = -1; net.send({ t: "hat", i: -1 }); } },
    onNet(m) { if (m.t === "hat") theirs = m.i; },
    update(dt, local, remote) { lastLocal = local; lastRemote = remote; if (mine >= 0 && mine === theirs) { if (!twin) { twin = true; FX.confetti(W / 2, H / 2, 40); FX.banner(W / 2, H * 0.3, "twinning! 👯"); FX.Sound.chime(); } } else twin = false; },
    draw(ctx) { drawHat(ctx, lastLocal, 0, mine); drawHat(ctx, lastRemote, 1, theirs); hint(ctx, "Dress-Up — “next hat” to cycle • match your partner's hat to twin 👯"); },
  };
}


// 🙏 MAKE A WISH — both press palms together
export function wishMode() {
  let t = 0;
  return {
    update(dt, local, remote) { if (t > 0) { t -= dt; return; } const solo = !(remote && remote.present); const lp = local && local.two && local.two.prayer, rp = solo ? lp : (remote && remote.two && remote.two.prayer); if (lp && rp) { FX.travel({ x: 20, y: 40 }, () => ({ x: W - 20, y: H * 0.5 }), "🌠", () => FX.burst(W - 60, H * 0.5, ["✨", "⭐", "💫"], 14, 220)); FX.flood(0, W, ["✨", "💫"], 20); FX.banner(W / 2, H * 0.3, "wish made together 🌠"); FX.Sound.chime(); t = 4; } },
    draw(ctx) { big(ctx, "🙏 Make a Wish", "both press your palms together"); },
  };
}


// 🙌 HANDS UP — both raise hands to hype
export function handsUpMode() {
  let combo = 0, prev = false;
  return {
    update(dt, local, remote) { const solo = !(remote && remote.present); const l = local && local.two && local.two.handsUp, r = solo ? l : (remote && remote.two && remote.two.handsUp); const both = l && r; if (both && !prev) { combo++; FX.flood(0, W, ["🙌", "🎉", "✨", "🥳"], 40); FX.burst(W / 2, H / 2, ["🙌"], 16); FX.Sound.chime(); } prev = both; },
    draw(ctx) { big(ctx, "🙌 Hands Up! " + (combo ? "×" + combo : ""), "both raise your hands to celebrate 🥳"); },
  };
}


// 💓 LOVE TAP — buzz your partner's phone
export function loveTapMode() {
  return {
    action(a) { if (a === "tap") { try { navigator.vibrate && navigator.vibrate([90, 50, 90]); } catch (_) {} net.send({ t: "buzz" }); FX.flood(0, W, ["💓", "💗"], 16); FX.Sound.pop(); } },
    draw(ctx) { big(ctx, "💓 Love Tap", "press send — buzz your partner's phone 📳"); },
  };
}

export const modes = {
  "kisscam": { cat: "Couple", ic: "💋", nm: "Kiss Cam", how: ["Press start for a countdown", "Both pucker up for the smooch cam 💕"], actions: [["start", "💋 start"]], make: kissCamMode },
  "mashup": { cat: "Couple", ic: "💞", nm: "Name Mash", how: ["Enter both your names", "Get your couple name"], actions: [["go", "💞 mash"]], make: mashupMode },
  "lovecalc": { cat: "Couple", ic: "❤️", nm: "Love Calc", how: ["Enter both names", "See your (very flattering) compatibility %"], actions: [["calc", "❤️ calc"]], make: loveCalcMode },
  "spinner": { cat: "Couple", ic: "🎡", nm: "Date Spinner", how: ["Spin for a random date-night idea"], actions: [["spin", "🎡 spin"]], make: spinnerMode },
  "pictionary": { cat: "Couple", ic: "🎨", nm: "Pictionary", how: ["One person: “new word”, then pinch to draw it", "The other: say it out loud or type a guess"], actions: [["word", "🎨 new word"], ["guess", "🗣 guess"], ["reveal", "👀 reveal"], ["clear", "clear"]], make: pictionaryMode },
  "mailbox": { cat: "Couple", ic: "💌", nm: "Mailbox", how: ["“write” a love note → delivered to your partner", "Saved here so you can re-read them"], actions: [["write", "💌 write"]], make: mailboxMode },
  "bucket": { cat: "Couple", ic: "🪣", nm: "Bucket List", how: ["“add” things to do together", "Pinch an item to check it off (synced)"], actions: [["add", "➕ add"], ["clear", "🗑"]], make: bucketMode },
  "dressup": { cat: "Couple", ic: "👒", nm: "Dress-Up", how: ["Cycle through hats", "Match your partner's hat to twin 👯"], actions: [["next", "👒 next hat"], ["off", "off"]], make: dressUpMode },
  "wish": { cat: "Couple", ic: "🙏", nm: "Make a Wish", how: ["Both press your palms together 🙏", "A shooting star grants your shared wish"], make: wishMode },
  "handsup": { cat: "Couple", ic: "🙌", nm: "Hands Up!", how: ["Both raise your hands at the same time", "Hype counter goes up with confetti 🥳"], make: handsUpMode },
  "lovetap": { cat: "Couple", ic: "💓", nm: "Love Tap", how: ["Press send to buzz your partner's phone 📳", "A little haptic “thinking of you”"], actions: [["tap", "💓 send"]], make: loveTapMode },
};
