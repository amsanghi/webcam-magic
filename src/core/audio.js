// audio.js — mic analyser: live loudness (always), autocorrelation pitch (only
// when a pitch game sets host.audio.want), a beat transient for beat-reactive
// visuals, and free-play clap/cheer detection. Writes host.audio.level/pitch
// and FX.setBeat(); `clapEnabled()` gates the clap burst to free-play + fx-on.

import * as FX from "../fx/effects.js";

export function createAudio(host, clapEnabled) {
  const W = FX.W, H = FX.H;
  let analyser = null, beatBuf = null, beatEMA = 0, lastTotal = 0, clapCd = 0, timeBuf = null, sampleRate = 44100;
  function initBeat(stream) {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      sampleRate = a.sampleRate;
      const src = a.createMediaStreamSource(stream);
      analyser = a.createAnalyser(); analyser.fftSize = 2048; beatBuf = new Uint8Array(analyser.frequencyBinCount); timeBuf = new Float32Array(analyser.fftSize);
      src.connect(analyser);
    } catch (_) {}
  }
  // autocorrelation pitch detector (for "match the note" / hum games)
  function detectPitch() {
    if (!analyser || !timeBuf) return 0;
    analyser.getFloatTimeDomainData(timeBuf);
    const N = timeBuf.length; let rms = 0; for (let i = 0; i < N; i++) rms += timeBuf[i] * timeBuf[i]; rms = Math.sqrt(rms / N);
    host.audio.level = Math.min(1, rms * 4);
    if (!host.audio.want || rms < 0.01) return 0;              // autocorr only when a pitch game is active
    let best = -1, bestOff = -1;
    for (let off = 8; off < 1000; off++) { let corr = 0; for (let i = 0; i < N - off; i++) corr += timeBuf[i] * timeBuf[i + off]; corr /= (N - off); if (corr > best) { best = corr; bestOff = off; } }
    return bestOff > 0 ? sampleRate / bestOff : 0;
  }
  function stepBeat() {
    if (!analyser) return;
    analyser.getByteFrequencyData(beatBuf);
    let sum = 0; for (let i = 0; i < 24; i++) sum += beatBuf[i];      // low-end energy
    const e = sum / (24 * 255);
    beatEMA = beatEMA * 0.9 + e * 0.1;
    FX.setBeat(Math.max(0, Math.min(1, (e - beatEMA) * 4)));          // transient above moving average
    // clap / cheer detection — sharp broadband spike (free mode only)
    let tot = 0; for (let i = 0; i < beatBuf.length; i++) tot += beatBuf[i]; tot /= beatBuf.length * 255;
    if (clapCd > 0) clapCd--;
    if (clapEnabled() && clapCd === 0 && tot - lastTotal > 0.16 && tot > 0.34) { clapCd = 30; FX.burst(W / 2, H * 0.4, ["👏", "🎉"], 12, 320); FX.Sound.applause(); }
    lastTotal = tot;
    host.audio.pitch = detectPitch();
  }
  return { initBeat, stepBeat };
}
