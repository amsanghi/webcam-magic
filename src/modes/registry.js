// registry.js — single source of truth for the mode catalog.
//
// Each topic file (create/party/gestureGames/senses/couple/talk/chill/afterdark)
// exports a `modes` object whose entries co-locate a mode's metadata with its
// factory ({ cat, ic, nm, how, actions?, make }). This module merges them into
// the maps the app + menu need, so ADDING A MODE means editing ONE topic file:
// write the factory and add its entry to that file's `modes`. It shows up here,
// in the menu, and in the ready-screen how-to automatically.

import { initContext, setAuthority, authority } from "./context.js";
import { createShareMode } from "./share.js";
import { modes as create } from "./create.js";
import { modes as party } from "./party.js";
import { modes as gestureGames } from "./gestureGames.js";
import { modes as senses } from "./senses.js";
import { modes as couple } from "./couple.js";
import { modes as talk } from "./talk.js";
import { modes as chill } from "./chill.js";
import { modes as afterdark } from "./afterdark.js";
import { modes as aiModes } from "./ai.js";

const GROUPS = [create, party, gestureGames, senses, couple, talk, chill, afterdark, aiModes];

// Ordering of the menu sections.
export const CAT_ORDER = ["Free play", "Single effects 🎯", "Create", "Games", "New senses 🎙️", "AI ✨", "Couple", "Talk & connect 💬", "Chill", "After dark 🌶️"];

// Two non-factory / special entries the app owns directly.
export const MODE_INFO = {
  free: {"ic": "✨", "nm": "Free Play", "cat": "Free play", "how": ["Smile → sparkles, kiss → flying lips, laugh → screen shakes", "👋 wave, ✌️ peace, 👍/👎, 🤟 rock-on, 👉 point = laser, 🤙 finger-guns = confetti", "🫶 make a heart with both hands → hearts flood", "Frame your face = vignette, clap = applause, snap = spotlight", "Together: reach the centre to hold hands • both smile = rainbow • both heart = eruption"]},
  share: {"ic": "📎", "nm": "Share", "cat": "Create", "how": ["Add an image, a PDF, or capture a window/screen", "Pinch to grab & move it", "Two hands: spread = resize, twist = rotate", "Open-palm swipe to flip PDF pages"]},
};
export const MODE_ACTIONS = {
  share: [["image", "🖼 image"], ["pdf", "📄 pdf"], ["window", "🪟 window"], ["prev", "◀"], ["next", "▶"], ["remove", "🗑"]],
};

// factory registry: id -> factory function () => mode object.
const factories = {};
for (const group of GROUPS) {
  for (const id in group) {
    const m = group[id];
    MODE_INFO[id] = { ic: m.ic, nm: m.nm, cat: m.cat, how: m.how };
    if (m.actions) MODE_ACTIONS[id] = m.actions;
    factories[id] = m.make;
  }
}

// Each free-play effect is also playable on its own as mode id "fx:<id>".
const FEATURES = [["smile", "😀", "Sparkle Smile", "Smile → sparkles rain (bigger smile = more)"], ["kiss", "💋", "Flying Kisses", "Pucker/kiss → lips fly from your mouth"], ["brow", "😮", "Shock", "Raise your eyebrows → 😮 and a pop"], ["blink", "😉", "Camera Flash", "Hard blink → flash + a 📸 snapshot"], ["tongue", "😝", "Raspberry", "Stick your tongue out → 😜 + raspberry"], ["laugh", "😂", "Laugh Riot", "Open-mouth laugh → 😂 balloons + screen shake"], ["frown", "☔", "Rain Cloud", "Frown → a rain cloud parks over your head"], ["zoned", "💤", "Zzz", "Zone out → a 💤 floats up"], ["wave", "👋", "Glitter Wave", "Open-hand wave → a glitter trail + 'hi!'"], ["guns", "🤙", "Finger Guns", "Finger-guns → confetti shots"], ["peace", "✌️", "Peace Rain", "✌️ peace → peace signs rain down"], ["thumbsup", "👍", "Thumbs Up", "👍 → a big +1 floats up"], ["thumbsdown", "👎", "Thumbs Down", "👎 → boo + tomatoes"], ["rockon", "🤟", "Rock On", "🤟 → flames + concert lights + riff"], ["snap", "🫰", "Spotlight", "Snap pose → a spotlight on you"], ["point", "👉", "Laser Pointer", "Point → a laser dot follows your finger"], ["clap", "👏", "Applause", "Clap your hands → applause + 👏"], ["frame", "🖼️", "Glam Vignette", "Frame your face with both hands → vignette"], ["circle", "🔮", "Orb", "Make a circle with both hands → a glowing orb"], ["squish", "🤏", "Cheek Squish", "Cup your face with both hands → squiish"]];
for (const [id, ic, nm, how] of FEATURES)
  MODE_INFO["fx:" + id] = { ic, nm, cat: "Single effects 🎯", how: [how, "It's the only effect on — everything else is off."] };

// ---- mode manager (was createGames in games.js) --------------------------
// Wires the shared context once, registers the special Share factory, then
// drives the active mode's lifecycle.
export function createGames(net, host) {
  initContext({ net, host });
  factories.share = createShareMode(net, () => (authority ? 0 : 1));
  let M = null, modeName = "free";
  function setMode(name) {
    if (M && M.exit) M.exit();
    modeName = name;
    M = factories[name] ? factories[name]() : null;
    if (M && M.enter) M.enter();
  }
  return {
    setMode, setAuthority,
    get mode() { return modeName; },
    update(dt, local, remote) { if (M && M.update) M.update(dt, local, remote); },
    draw(ctx) { if (M && M.draw) M.draw(ctx); },
    onNet(m) { if (M && M.onNet) M.onNet(m); },
    action(a) { if (M && M.action) M.action(a); },
  };
}
