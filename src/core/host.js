// host.js — builds the shared `host` services object handed to every mode.
// Bundles snapshots, the non-blocking text prompt, voice-to-text, the optional
// detector output slots (objects/pose/seg), live audio, pointer, video hue,
// phone sensors and geolocation. Needs the main canvas (for snapshots) and the
// local <video> element (for hue sampling).

import { createVoice } from "../perception/voice.js";

export function createHost(canvas, localVideo) {
  const MOMENTS = [];   // in-memory session gallery (full-res blob URLs) — no auto-download
  function persistThumb() {   // small thumbnail for cross-session Scrapbook
    try { const c = document.createElement("canvas"); c.width = 320; c.height = 180; c.getContext("2d").drawImage(canvas, 0, 0, 320, 180); const url = c.toDataURL("image/jpeg", 0.6); const arr = JSON.parse(localStorage.getItem("wm_scrapbook") || "[]"); arr.push(url); localStorage.setItem("wm_scrapbook", JSON.stringify(arr.slice(-40))); } catch (_) {}
  }
  const host = {
    moments: MOMENTS,
    // silent capture — collects into the Scrapbook without downloading (a download
    // pops OS UI that can pause the tab and stall the call). Export later.
    snapMoment: () => {
      canvas.toBlob((b) => { if (!b) return; const url = URL.createObjectURL(b); MOMENTS.push({ url }); if (MOMENTS.length > 60) URL.revokeObjectURL(MOMENTS.shift().url); }, "image/jpeg", 0.88);
      persistThumb();
    },
    // explicit download (📸 button)
    snapshot: (name) => {
      canvas.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = (name || "webcam-magic") + ".png"; a.click(); });
      persistThumb();
    },
    // Non-blocking text prompt. NEVER use window.prompt during a call — it freezes
    // the whole tab (stops packets), so the partner sees a silent link and reconnects.
    ask: (label, opts = {}) => new Promise((resolve) => {
      const wrap = document.createElement("div"); wrap.className = "ask-modal";
      const field = opts.multiline ? "<textarea rows='6'></textarea>" : "<input type='text' />";
      wrap.innerHTML = `<div class="ask-card"><label>${label}</label>${field}<div class="ask-row"><button class="ask-cancel">Cancel</button><button class="ask-ok">OK</button></div></div>`;
      document.body.appendChild(wrap);
      const f = wrap.querySelector(opts.multiline ? "textarea" : "input");
      if (opts.value) f.value = opts.value; setTimeout(() => f.focus(), 30);
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector(".ask-ok").onclick = () => done(f.value);
      wrap.querySelector(".ask-cancel").onclick = () => done(null);
      wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
      f.addEventListener("keydown", (e) => { if (e.key === "Enter" && !opts.multiline) done(f.value); if (e.key === "Escape") done(null); });
    }),
    // 🗣️ voice-to-text (Web Speech API)
    voice: createVoice(),
    // 🔍 object detection — modes set want=true to have the loop populate labels[]
    objects: { want: false, labels: [] },
    // 🧍 body pose — modes set want=true; lm[] = 33 normalized {x,y} landmarks
    pose: { want: false, lm: [] },
    // 🕳️ body silhouette — modes set want=true; grid[gh×gw] = 1 where you are
    seg: { want: false, gw: 22, gh: 26, grid: new Uint8Array(22 * 26), count: 0 },
    // 🎤 live audio: level (0..1 loudness) always; pitch (Hz) only when want=true
    audio: { level: 0, pitch: 0, want: false },
    // 🖱️ last tap/click on the canvas, in logical (W×H) coords (mouse or touch)
    pointer: { x: 0, y: 0, t: 0 },
    // 🎨 dominant hue (0..360) of the centre of your video
    videoHue: () => { try { const c = document.createElement("canvas"); c.width = 32; c.height = 32; const cx = c.getContext("2d"); cx.drawImage(localVideo, localVideo.videoWidth * .3, localVideo.videoHeight * .3, localVideo.videoWidth * .4, localVideo.videoHeight * .4, 0, 0, 32, 32); const d = cx.getImageData(0, 0, 32, 32).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } r /= n; g /= n; b /= n; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn; if (dl < 18) return -1; let h = 0; if (mx === r) h = ((g - b) / dl) % 6; else if (mx === g) h = (b - r) / dl + 2; else h = (r - g) / dl + 4; h = (h * 60 + 360) % 360; return h; } catch (_) { return -1; } },
    // 📱 phone sensors + 🌍 GPS
    sensors: { on: false, beta: 0, gamma: 0, shake: 0 },
    requestSensors: async () => {
      try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch (_) {}
      try { if (window.DeviceMotionEvent && DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission(); } catch (_) {}
      if (host.sensors.on) return; host.sensors.on = true;
      window.addEventListener("deviceorientation", (e) => { host.sensors.beta = e.beta || 0; host.sensors.gamma = e.gamma || 0; });
      window.addEventListener("devicemotion", (e) => { const a = e.accelerationIncludingGravity || {}; host.sensors.shake = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0); });
    },
    geo: () => new Promise((res) => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { timeout: 8000, maximumAge: 60000 }); }),
  };
  return host;
}
