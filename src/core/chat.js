// chat.js — the persistent chat/input dock on the play screen. Replaces the
// old pop-up "ask" modal with an inline message feed + input bar, and is the
// home for the AI companion, voice input (STT) and voice output (TTS).
//
// - say(from, text)  append a bubble (from: you | partner | ai | sys)
// - ask(label,opts)  Promise<string|null> — shows the prompt, resolves on send
// - onSend(text)     called for a normal (non-ask) message → routed to the mode
//                    or the AI companion by app.js
// - mic 🎤           fills the input from speech (Web Speech STT)
// - speaker 🔊       toggles reading AI replies aloud (speechSynthesis TTS)

export function createChat({ voice, onSend }) {
  const $ = (id) => document.getElementById(id);
  const feed = $("chatFeed"), form = $("chatForm"), input = $("chatInput");
  const mic = $("micBtn"), tts = $("ttsBtn");
  let pending = null;               // {resolve, placeholder}
  let listening = false, ttsOn = false;
  const DEFAULT_PH = "Message Cupid, or type your answer…";

  function bubble(from, text) {
    const el = document.createElement("div");
    el.className = "msg " + from;
    el.textContent = text;
    feed.appendChild(el);
    feed.scrollTop = feed.scrollHeight;
    while (feed.children.length > 80) feed.removeChild(feed.firstChild);
    return el;
  }
  function say(from, text) { if (text != null && text !== "") bubble(from, text); if (from === "ai") speak(text); }
  function clear() { feed.innerHTML = ""; }

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

  // 🎤 speech-to-text into the input
  if (mic) {
    if (!voice || !voice.supported) mic.style.display = "none";
    else mic.addEventListener("click", () => {
      if (listening) { voice.stop(); listening = false; mic.classList.remove("on"); return; }
      listening = true; mic.classList.add("on");
      voice.start((t, final) => { input.value = t; if (final) { voice.stop(); listening = false; mic.classList.remove("on"); } });
    });
  }
  // 🔊 read AI replies aloud
  function speak(text) {
    if (!ttsOn || !window.speechSynthesis) return;
    try { const u = new SpeechSynthesisUtterance(String(text).replace(/[\u{1F000}-\u{1FFFF}☀-➿]/gu, "")); u.rate = 1.02; u.pitch = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (_) {}
  }
  if (tts) {
    if (!window.speechSynthesis) tts.style.display = "none";
    else tts.addEventListener("click", () => { ttsOn = !ttsOn; tts.classList.toggle("on", ttsOn); if (!ttsOn) try { speechSynthesis.cancel(); } catch (_) {} });
  }

  return { say, clear, ask, speak, get ttsOn() { return ttsOn; } };
}
