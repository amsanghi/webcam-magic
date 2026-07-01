// memory.js — the couple's persistent, shared memory. Three parts:
//   • profile   who they are: names, anniversary, love languages, inside jokes,
//               likes/dislikes, boundaries, and the spice ceiling (0..2).
//   • episodic  a rolling log of what actually happened (moments, games, answers).
//   • recaps    end-of-night summaries the host writes, so it remembers past nights.
//
// Backed by localStorage so it works with no server. A compact snapshot() syncs to
// the partner over the data channel (applyRemote) so both devices remember the same
// things — a server backend can later replace the storage without changing this API.
// forPrompt() distills it into a short note injected into the AI's prompts; that's
// what makes replies feel personal ("remembers everything").

const KEY = "wm_memory";
const EP_CAP = 48, RECAP_CAP = 12;
const nowISO = () => { try { return new Date().toISOString(); } catch (_) { return "" + Date.now(); } };

function load() {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
  if (!m || typeof m !== "object") m = {};
  m.v = 1;
  m.profile = m.profile || {};
  if (!Array.isArray(m.episodic)) m.episodic = [];
  if (!Array.isArray(m.recaps)) m.recaps = [];
  if (m.profile.spice == null) m.profile.spice = 2;   // the couple chose fully uncensored; dial-able
  // migrate the standalone keys the app already wrote before memory existed
  try { if (!m.profile.a) { const p = JSON.parse(localStorage.getItem("wm_profile") || "{}"); if (p.a) { m.profile.a = p.a; m.profile.b = p.b || ""; } } } catch (_) {}
  try { if (!m.profile.anniversary) { const d = localStorage.getItem("wm_anniv"); if (d) m.profile.anniversary = d; } } catch (_) {}
  return m;
}

export function createMemory({ onChange } = {}) {
  let m = load();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (_) {} };
  // sync=false means "applied a remote update" — persist + let derived state (names
  // into the AI) refresh, but don't echo it back to the partner (avoids a loop).
  const changed = (sync = true) => { persist(); if (onChange) try { onChange(sync); } catch (_) {} };

  const names = () => (m.profile.a && m.profile.b ? `${m.profile.a} & ${m.profile.b}` : m.profile.a || "you two");
  const daysTogether = () => { try { if (!m.profile.anniversary) return null; return Math.max(0, Math.floor((Date.now() - new Date(m.profile.anniversary).getTime()) / 864e5)); } catch (_) { return null; } };

  function note(kind, text) {
    text = String(text || "").slice(0, 140); if (!text) return;
    const last = m.episodic[m.episodic.length - 1];
    if (last && last.text === text) return;               // skip immediate repeats
    m.episodic.push({ t: nowISO(), kind: kind || "note", text });
    if (m.episodic.length > EP_CAP) m.episodic = m.episodic.slice(-EP_CAP);
    changed();
  }
  function recap(text) {
    text = String(text || "").slice(0, 400); if (!text) return;
    m.recaps.push({ t: nowISO(), text });
    if (m.recaps.length > RECAP_CAP) m.recaps = m.recaps.slice(-RECAP_CAP);
    changed();
  }
  function setProfile(patch) {
    if (!patch) return;
    m.profile = Object.assign({}, m.profile, patch);
    if (m.profile.spice != null) m.profile.spice = Math.max(0, Math.min(2, m.profile.spice | 0));
    changed();
  }

  // A compact "what Cupid knows" note for prompts. Kept short (it rides on the call).
  function forPrompt() {
    const p = m.profile, bits = [];
    if (p.a && p.b) bits.push(`They are ${p.a} and ${p.b}, a couple.`);
    const d = daysTogether(); if (d != null) bits.push(`${d} days together.`);
    if (p.loveLangs) bits.push(`Love languages: ${p.loveLangs}.`);
    if (p.likes) bits.push(`They like: ${p.likes}.`);
    if (Array.isArray(p.jokes) && p.jokes.length) bits.push(`Inside jokes: ${p.jokes.slice(-3).join("; ")}.`);
    if (p.boundaries) bits.push(`Respect these boundaries: ${p.boundaries}.`);
    const lr = m.recaps[m.recaps.length - 1]; if (lr) bits.push(`Last time: ${lr.text}`);
    const rec = m.episodic.slice(-6).map((e) => e.text); if (rec.length) bits.push(`Tonight so far: ${rec.join("; ")}.`);
    return bits.length ? " Context you remember — " + bits.join(" ") : "";
  }

  // cross-peer sync — a bounded snapshot; applyRemote merges without re-broadcasting.
  function snapshot() { return { profile: m.profile, recaps: m.recaps.slice(-4), episodic: m.episodic.slice(-8) }; }
  function applyRemote(snap) {
    if (!snap) return;
    if (snap.profile) for (const k in snap.profile) if (m.profile[k] == null || m.profile[k] === "") m.profile[k] = snap.profile[k];
    const key = (e) => e.t + "|" + e.text;
    const mergeList = (mine, theirs, cap) => { const seen = new Set(mine.map(key)); for (const e of theirs || []) if (!seen.has(key(e))) mine.push(e); mine.sort((x, y) => (x.t < y.t ? -1 : 1)); return mine.slice(-cap); };
    m.recaps = mergeList(m.recaps, snap.recaps, RECAP_CAP);
    m.episodic = mergeList(m.episodic, snap.episodic, EP_CAP);
    changed(false);
  }

  return {
    get profile() { return m.profile; },
    get spice() { return m.profile.spice; },
    names, daysTogether, note, recap, setProfile, forPrompt, snapshot, applyRemote,
    recent: (n = 6) => m.episodic.slice(-n),
    lastRecap: () => m.recaps[m.recaps.length - 1] || null,
    setSpice: (n) => setProfile({ spice: n }),
    reset: () => { m = { v: 1, profile: { spice: 2 }, episodic: [], recaps: [] }; changed(); },
  };
}
