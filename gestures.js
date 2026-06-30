// gestures.js — classify hands + face from MediaPipe results into a rich state.
// All returned points are DISPLAY-normalized [0..1] within one half (x mirrored
// for the selfie view). Temporal state (wave velocity, zoned timer) is module-
// level and applies to the LOCAL camera only; the remote side is received whole.

// Live-tunable thresholds (the "feel" knobs). The debug panel mutates these.
export const TUNE = {
  smile: 0.40, kiss: 0.50, brow: 0.60, frown: 0.55, blink: 0.55, tongue: 0.40,
  laughJaw: 0.35, laughSmile: 0.25, pinch: 0.45, snap: 0.40, wave: 0.012,
  seam: 0.82, zonedSec: 6,
};

const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mir = (lm) => ({ x: 1 - lm.x, y: lm.y });           // raw -> display-normalized

export function blankState() {
  return {
    present: false, wave: false,
    poses: { point: false, fingerGuns: false, rockOn: false, peace: false,
             thumbsUp: false, thumbsDown: false, ok: false, snap: false, fist: false, palm: false },
    pinch: { active: false, x: 0, y: 0 },
    point: { active: false, x: 0, y: 0 },
    palm: null, hands: [],
    two: { heart: false, frame: false, clap: false, cup: false,
           spread: { active: false, dist: 0 }, twist: { active: false, angle: 0 }, circle: { active: false, x: 0, y: 0, r: 0 } },
    face: { present: false, smile: 0, kiss: 0, brow: 0, frown: 0, blink: 0, tongue: 0, laugh: 0, zoned: false, headShake: false, nose: null, mouth: null },
  };
}

// which fingers are extended (distance-from-wrist heuristic, orientation-free)
function fingersUp(lm) {
  const w = lm[0];
  const up = (tip, pip) => D(lm[tip], w) > D(lm[pip], w);
  return {
    thumb: D(lm[4], w) > D(lm[2], w) * 1.05,
    index: up(8, 6), middle: up(12, 10), ring: up(16, 14), pinky: up(20, 18),
  };
}

function classifyHand(lm) {
  const f = fingersUp(lm);
  const w = lm[0];
  const hs = D(w, lm[9]) || 1;
  const pinchD = D(lm[4], lm[8]) / hs;                     // thumb-index
  const snapD = D(lm[4], lm[12]) / hs;                     // thumb-middle
  const cnt = f.index + f.middle + f.ring + f.pinky;
  let pose = "";
  if (pinchD < TUNE.pinch && !f.middle && !f.ring && !f.pinky) pose = "pinch";
  else if (pinchD < TUNE.pinch && f.middle && f.ring) pose = "ok";
  else if (snapD < TUNE.snap && f.index) pose = "snap";
  else if (f.thumb && cnt === 0) pose = (lm[4].y > w.y ? "thumbsDown" : "thumbsUp");
  else if (f.index && f.pinky && !f.middle && !f.ring) pose = "rockOn";
  else if (f.thumb && f.index && !f.middle && !f.ring && !f.pinky) pose = "fingerGuns";
  else if (f.index && f.middle && !f.ring && !f.pinky) pose = "peace";
  else if (f.index && !f.middle && !f.ring && !f.pinky) pose = "point";
  else if (cnt >= 4) pose = "palm";
  else if (cnt === 0) pose = "fist";
  return {
    pose, f,
    palm: mir(lm[9]), wrist: mir(w), indexTip: mir(lm[8]), thumbTip: mir(lm[4]), pinkyTip: mir(lm[20]),
    pinchPt: { x: (1 - (lm[4].x + lm[8].x) / 2), y: (lm[4].y + lm[8].y) / 2 }, pinchD,
  };
}

// module-level temporal state (local camera)
let lastPalmX = null, zonedT = 0, noseHist = [];

export function classifyHands(landmarks, state) {
  const hands = (landmarks || []).map(classifyHand);
  state.present = hands.length > 0;
  state.hands = hands.map((h) => h.palm);

  // reset per-frame
  const P = state.poses;
  for (const k in P) P[k] = false;
  state.pinch.active = false; state.point.active = false; state.palm = null;
  state.two.heart = state.two.frame = state.two.clap = state.two.cup = false;
  state.two.spread.active = state.two.twist.active = state.two.circle.active = false;

  let palmHand = null;
  for (const h of hands) {
    if (h.pose) P[h.pose] = true;
    if (h.pose === "pinch") { state.pinch.active = true; state.pinch.x = h.pinchPt.x; state.pinch.y = h.pinchPt.y; }
    if (h.pose === "point") { state.point.active = true; state.point.x = h.indexTip.x; state.point.y = h.indexTip.y; }
    if (h.pose === "palm") { palmHand = h; state.palm = h.palm; }
    if (h.pose === "snap") { state.palm = state.palm || h.palm; }
  }

  // wave = open palm moving sideways
  state.wave = false;
  if (palmHand) {
    if (lastPalmX != null && Math.abs(palmHand.palm.x - lastPalmX) > TUNE.wave) state.wave = true;
    lastPalmX = palmHand.palm.x;
  } else lastPalmX = null;

  // two-hand combos
  if (hands.length >= 2) {
    const [a, b] = hands;
    const hs = (D(a.wrist, a.palm) + D(b.wrist, b.palm)) / 2 || 1;
    // heart
    const idxGap = D(a.indexTip, b.indexTip) / hs, thbGap = D(a.thumbTip, b.thumbTip) / hs;
    state.two.heart = idxGap < 0.7 && thbGap < 1.0 && (a.indexTip.y + b.indexTip.y) / 2 < (a.thumbTip.y + b.thumbTip.y) / 2;
    // spread / twist (always available when 2 hands)
    const dx = b.palm.x - a.palm.x, dy = b.palm.y - a.palm.y;
    state.two.spread.active = true; state.two.spread.dist = Math.hypot(dx, dy);
    state.two.twist.active = true; state.two.twist.angle = Math.atan2(dy, dx);
    // clap = two palms close together
    state.two.clap = a.pose === "palm" && b.pose === "palm" && D(a.palm, b.palm) < 0.18;
    // frame = both "L"/fingerGuns shapes, hands far apart diagonally
    state.two.frame = (a.f.index && b.f.index) && Math.abs(dx) > 0.25 && (a.pose === "fingerGuns" || b.pose === "fingerGuns" || (a.f.thumb && b.f.thumb));
    // cup = two palms near each other, low in frame
    state.two.cup = a.pose === "palm" && b.pose === "palm" && D(a.palm, b.palm) < 0.32 && (a.palm.y + b.palm.y) / 2 > 0.55;
    // circle/orb = thumb tips meet AND pinky tips meet (hands form a ring)
    const thumbMeet = D(a.thumbTip, b.thumbTip) / hs < 0.6, pinkyMeet = D(a.pinkyTip, b.pinkyTip) / hs < 0.9;
    if (thumbMeet && pinkyMeet) {
      state.two.circle.active = true;
      state.two.circle.x = (a.palm.x + b.palm.x) / 2; state.two.circle.y = (a.palm.y + b.palm.y) / 2;
      state.two.circle.r = D(a.palm, b.palm);
    }
  }
  return state;
}

export function classifyFace(blendshapes, faceLandmarks, state, dt) {
  const F = state.face;
  const bs = blendshapes, lms = faceLandmarks;
  if (!bs || !lms) { F.present = false; F.smile = F.kiss = F.brow = F.frown = F.blink = F.tongue = F.laugh = 0; F.mouth = F.nose = null; return state; }
  F.present = true;
  const g = (n) => { const c = bs.categories.find((c) => c.categoryName === n); return c ? c.score : 0; };
  F.smile = (g("mouthSmileLeft") + g("mouthSmileRight")) / 2;
  F.kiss = g("mouthPucker");
  F.brow = Math.max(g("browInnerUp"), (g("browOuterUpLeft") + g("browOuterUpRight")) / 2);
  F.frown = (g("mouthFrownLeft") + g("mouthFrownRight")) / 2;
  F.blink = Math.min(g("eyeBlinkLeft"), g("eyeBlinkRight"));   // both eyes
  F.tongue = g("tongueOut");
  const jaw = g("jawOpen");
  F.laugh = (jaw > TUNE.laughJaw && F.smile > TUNE.laughSmile) ? 1 : 0;
  F.nose = mir(lms[1]);
  F.mouth = { x: 1 - (lms[13].x + lms[14].x) / 2, y: (lms[13].y + lms[14].y) / 2 };

  // head-shake: nose x oscillating quickly side to side
  noseHist.push(F.nose.x); if (noseHist.length > 8) noseHist.shift();
  let dirs = 0;
  for (let i = 2; i < noseHist.length; i++) {
    const a = noseHist[i] - noseHist[i - 1], b = noseHist[i - 1] - noseHist[i - 2];
    if (a * b < 0 && Math.abs(a) > 0.012) dirs++;          // direction reversal with motion
  }
  F.headShake = dirs >= 3;

  // zoned-out: low everything for a sustained while
  const flat = F.smile < 0.1 && F.brow < 0.1 && F.frown < 0.1 && jaw < 0.12 && !state.present;
  zonedT = flat ? zonedT + dt : 0;
  F.zoned = zonedT > TUNE.zonedSec;
  return state;
}

export function resetTemporal() { lastPalmX = null; zonedT = 0; noseHist = []; }
