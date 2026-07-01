// chat.js — the persistent chat/input dock on the play screen. An inline message
// feed + input bar; home for the AI companion (Cupid), voice input (STT) and
// voice output (TTS).
//
// - say(from, text)  append a message (from: you | partner | ai | sys)
// - ask(label,opts)  Promise<string|null> — shows the prompt, resolves on send
// - thinking(on)     show/hide Cupid's animated "typing" bubble
// - onSend(text)     called for a normal (non-ask) message → routed to the mode
//                    or the AI companion by app.js
// - mic              fills the input from speech (Web Speech STT)
// - speaker          toggles reading AI replies aloud (speechSynthesis TTS)

import { ICON } from "./icons.js";

export function createChat({ voice, onSend }) {
  const $ = (id) => document.getElementById(id);
  const feed = $("chatFeed"), form = $("chatForm"), input = $("chatInput");
  const mic = $("micBtn"), tts = $("ttsBtn");
  let pending = null;               // {resolve}
  let listening = false, ttsOn = false, typingEl = null;
  const DEFAULT_PH = "Message Cupid, or type your answer…";

  const AVATAR = { ai: ICON.sparkles, partner: ICON.user };

  function bubble(from, text) {
    if (typingEl) thinking(false);                 // a real message supersedes the indicator
    const row = document.createElement("div");
    row.className = "msg " + from;
    if (AVATAR[from]) {
      const av = document.createElement("div");
      av.className = "avatar " + from;
      av.innerHTML = AVATAR[from];
      row.appendChild(av);
    }
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = text;
    row.appendChild(b);
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
    while (feed.children.length > 80) feed.removeChild(feed.firstChild);
    return b;
  }
  function say(from, text) { if (text != null && text !== "") bubble(from, text); if (from === "ai") speak(text); }
  function clear() { feed.innerHTML = ""; typingEl = null; }

  // Cupid's animated "…" bubble while a reply is being generated.
  function thinking(on) {
    if (on) {
      if (typingEl) return;
      typingEl = document.createElement("div");
      typingEl.className = "msg ai typing";
      typingEl.innerHTML = `<div class="avatar ai">${ICON.sparkles}</div><div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div>`;
      feed.appendChild(typingEl);
      feed.scrollTop = feed.scrollHeight;
    } else if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function ask(label, opts = {}) {
    return new Promise((resolve) => {
      if (pending) pending.resolve(null);           // supersede any prior prompt
      if (label) bubble("sys", label);
      input.placeholder = opts.placeholder || label || DEFAULT_PH;
      if (opts.value) input.value = opts.value;
      input.focus();
      pending = { resolve };
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    input.value = "";
    if (pending) { const p = pending; pending = null; input.placeholder = DEFAULT_PH; if (v) bubble("you", v); p.resolve(v); return; }
    if (!v) return;
    bubble("you", v);
    onSend && onSend(v);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && pending) { const p = pending; pending = null; input.value = ""; input.placeholder = DEFAULT_PH; p.resolve(null); } });

  // voice-to-text into the input
  if (mic) {
    if (!voice || !voice.supported) mic.style.display = "none";
    else mic.addEventListener("click", () => {
      if (listening) { voice.stop(); listening = false; mic.classList.remove("on"); return; }
      listening = true; mic.classList.add("on");
      voice.start((t, final) => { input.value = t; if (final) { voice.stop(); listening = false; mic.classList.remove("on"); } });
    });
  }
  // read AI replies aloud
  function speak(text) {
    if (!ttsOn || !window.speechSynthesis) return;
    try { const u = new SpeechSynthesisUtterance(String(text).replace(/[\u{1F000}-\u{1FFFF}☀-➿]/gu, "")); u.rate = 1.02; u.pitch = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (_) {}
  }
  if (tts) {
    if (!window.speechSynthesis) tts.style.display = "none";
    else {
      const ttsIcon = tts.querySelector(".icon") || tts;
      tts.addEventListener("click", () => { ttsOn = !ttsOn; tts.classList.toggle("on", ttsOn); ttsIcon.innerHTML = ttsOn ? ICON.volume : ICON.volumeOff; if (!ttsOn) try { speechSynthesis.cancel(); } catch (_) {} });
    }
  }

  return { say, clear, ask, speak, thinking, get ttsOn() { return ttsOn; } };
}
