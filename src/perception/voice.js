// voice.js — speech-to-text via the browser's Web Speech API (no server).
// Chrome/Edge (and Chrome on Android) support it; Firefox/Safari mostly don't.
// One recognizer per page: a mode calls voice.start(cb) in enter() and voice.stop()
// in exit(). cb(transcript, isFinal) fires with lowercased text.
export function createVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, cb = null, want = false, running = false;
  function begin() {
    if (running || !want) return;
    rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    rec.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (cb) cb((r[0].transcript || "").toLowerCase().trim(), r.isFinal); } };
    rec.onerror = () => {};
    rec.onend = () => { running = false; if (want) setTimeout(begin, 200); };   // auto-restart
    try { rec.start(); running = true; } catch (_) { running = false; }
  }
  return {
    supported: !!SR,
    start(fn) { if (!SR) return false; cb = fn; want = true; begin(); return true; },
    stop() { want = false; cb = null; try { rec && rec.stop(); } catch (_) {} running = false; },
  };
}
