// chill.js — Chill ambiance modes: slow dance, mood, breathe, karaoke, countdown.
import { FX, net, host, authority, meIdx, W, H, MID, toCanvas, rnd, pick, clamp, cursor, cursorPx, activeCur, roundRect, pill, outline, fit, hint, scoreboard, big } from "./_shared.js";

// centers to draw "shared" content at: once at screen center normally, once per
// half in the stacked phone view (where the seam would tear centered drawings)
const centers = () => (FX.isStacked() ? [W * 0.25, W * 0.75] : [W / 2]);


// ---------------- SLOW DANCE (romantic ambient + beat hearts) ------------
export function slowDanceMode() {
  let acc = 0;
  return {
    exit() { FX.setTint(255, 150, 180, 0); FX.setVignette(0, false); FX.setVignette(1, false); },
    update(dt) {
      FX.setTint(255, 150, 180, 0.18); FX.setVignette(0, true); FX.setVignette(1, true);
      const beat = FX.getBeat(); acc += dt * (2 + beat * 12);
      if (acc > 1) { acc = 0; FX.emoji(rnd(0, W), H + 20, rnd(-20, 20), -rnd(40, 95) * (1 + beat), pick(["💗", "💖", "💕", "🤍", "🌹"]), rnd(24, 44) * (1 + beat * 0.5), rnd(3, 5), -28, { vr: 0 }); }
    },
    draw(ctx) { ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = "#fff"; ctx.font = FX.isStacked() ? "15px system-ui" : "20px system-ui"; ctx.textAlign = "center"; for (const cx of centers()) ctx.fillText("💃  slow dance  🕺", cx, H - 26); ctx.restore(); },
  };
}


// ---------------- MOOD LIGHTING (candlelit ambiance) ---------------------
export function moodMode() {
  let acc = 0;
  return {
    exit() { FX.setTint(255, 110, 90, 0); FX.setVignette(0, false); FX.setVignette(1, false); },
    update(dt) { FX.setTint(255, 110, 90, 0.3); FX.setVignette(0, true); FX.setVignette(1, true); acc += dt; if (acc > 0.5) { acc = 0; FX.emoji(rnd(0, W), H + 20, rnd(-10, 10), -rnd(20, 50), pick(["🕯️", "🌹", "✨", "🥂"]), rnd(22, 38), rnd(4, 6), -20, { vr: 0 }); } },
    draw(ctx) { ctx.save(); ctx.globalAlpha = 0.8; ctx.fillStyle = "#fff"; ctx.font = FX.isStacked() ? "15px system-ui" : "20px system-ui"; ctx.textAlign = "center"; for (const cx of centers()) ctx.fillText("🕯️ mood lighting", cx, H - 26); ctx.restore(); },
  };
}


// ---------------- SYNCED BREATHING / CALM --------------------------------
export function breathingMode() {
  const seq = [["breathe in 🌬️", 4], ["hold", 2], ["breathe out 😌", 4], ["hold", 2]]; let t = 0;
  return {
    exit() { FX.setTint(120, 170, 255, 0); },
    update(dt) { FX.setTint(120, 170, 255, 0.12); t += dt; },
    draw(ctx) {
      const total = 12, tt = t % total; let acc = 0, idx = 0, pr = 0;
      for (let i = 0; i < seq.length; i++) { if (tt < acc + seq[i][1]) { idx = i; pr = (tt - acc) / seq[i][1]; break; } acc += seq[i][1]; }
      const scale = idx === 0 ? 0.45 + pr * 0.55 : idx === 1 ? 1 : idx === 2 ? 1 - pr * 0.55 : 0.45;
      // stacked: one ring per half (each of you breathes with your own ring)
      const half = FX.isStacked() ? 0.62 : 1;
      for (const cx of centers()) {
        ctx.save(); ctx.translate(cx, H / 2); const r = (90 + scale * 170) * half;
        ctx.fillStyle = "rgba(150,190,255,.15)"; ctx.strokeStyle = "rgba(180,210,255,.9)"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${Math.round(30 * half)}px system-ui`; ctx.fillText(seq[idx][0], 0, 0); ctx.restore();
      }
      ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "16px system-ui";
      for (const cx of centers()) ctx.fillText("breathe together 💙", cx, H - 26);
    },
  };
}


// ---------------- KARAOKE LYRIC CRAWL ------------------------------------
export function karaokeMode() {
  let lines = [], y = H, speed = 42;
  return {
    async action(a) { if (a === "lyrics") { const v = await host.ask("Paste lyrics (one line per line):", { multiline: true }); if (v) { lines = v.split("\n"); y = H; net.send({ t: "lyrics", text: v }); } } else if (a === "restart") y = H; },
    onNet(m) { if (m.t === "lyrics") { lines = m.text.split("\n"); y = H; } },
    update(dt) { if (lines.length) { y -= speed * dt; if (y < -lines.length * 46) y = H; } },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.font = "30px system-ui";
      if (!lines.length) return big(ctx, "🎤 Karaoke", "paste lyrics to start the crawl");
      lines.forEach((ln, i) => { const ly = y + i * 46; if (ly > -40 && ly < H + 40) { ctx.globalAlpha = 1 - Math.min(1, Math.abs(ly - H * 0.4) / (H * 0.6)); ctx.fillText(ln, W / 2, ly); } });
      ctx.globalAlpha = 1;
    },
  };
}


// ---------------- "DAYS TILL WE MEET" COUNTDOWN --------------------------
export function countdownMode() {
  const get = () => { try { return localStorage.getItem("wm_meet"); } catch (_) { return null; } };
  return {
    async action(a) { if (a === "set") { const v = await host.ask("Date you'll next meet (YYYY-MM-DD):", { value: get() || "" }); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) try { localStorage.setItem("wm_meet", v.trim()); } catch (_) {} } },
    draw(ctx) {
      ctx.textAlign = "center"; ctx.fillStyle = "#fff"; const d = get();
      if (!d) return big(ctx, "📅 set the date", "press “set date” for your next meetup");
      const days = Math.ceil((new Date(d).getTime() - Date.now()) / 864e5);
      big(ctx, days > 0 ? `${days} days 🥹` : days === 0 ? "TODAY!! 🎉" : "together at last 💕", days > 0 ? "till we're together" : "");
    },
  };
}

export const modes = {
  "slowdance": { cat: "Chill", ic: "💃", nm: "Slow Dance", how: ["Warm romantic ambiance", "Play music and sway — hearts pulse to the beat"], make: slowDanceMode },
  "mood": { cat: "Chill", ic: "🕯️", nm: "Mood", how: ["Candlelit ambiance, just the two of you"], make: moodMode },
  "breathing": { cat: "Chill", ic: "🧘", nm: "Breathe", how: ["Follow the ring — in, hold, out", "Breathe together to relax"], make: breathingMode },
  "karaoke": { cat: "Chill", ic: "🎤", nm: "Karaoke", how: ["Paste some lyrics", "They scroll like a teleprompter"], actions: [["lyrics", "🎤 lyrics"], ["restart", "↺"]], make: karaokeMode },
  "countdown": { cat: "Chill", ic: "⏳", nm: "Countdown", how: ["Set the date you'll next meet", "It counts down the days 🥹"], actions: [["set", "📅 set date"]], make: countdownMode },
};
