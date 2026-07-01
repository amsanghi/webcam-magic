// detectors.js — the three OPTIONAL, heavy MediaPipe detectors, loaded lazily
// the first time a mode asks for them (host.objects/pose/seg .want = true) and
// stepped once per frame from the render loop. Hand + face landmarking is the
// always-on core and stays in app.js; these are per-mode opt-ins.

import { FilesetResolver, ObjectDetector, PoseLandmarker, ImageSegmenter }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const VISION_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";  // keep version in sync with app.js
const OD_MODEL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const SEG_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

export function createDetectors(host, localVideo) {
  // object detector loaded lazily (only when a mode wants it — e.g. Treasure Hunt)
  let objDet = null, odLoading = false, odLastT = -1;
  async function ensureObjDet() { if (objDet || odLoading) return; odLoading = true; try { const vision = await FilesetResolver.forVisionTasks(VISION_WASM); objDet = await ObjectDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: OD_MODEL, delegate: "GPU" }, scoreThreshold: 0.45, maxResults: 6, runningMode: "VIDEO" }); } catch (_) {} odLoading = false; }
  function stepObjects() {
    if (!host.objects.want) return;
    if (!objDet) { ensureObjDet(); return; }
    if (localVideo.readyState < 2 || localVideo.currentTime === odLastT) return;
    odLastT = localVideo.currentTime;
    try { const r = objDet.detectForVideo(localVideo, performance.now() + 2); host.objects.labels = (r.detections || []).map((d) => d.categories[0] && d.categories[0].categoryName).filter(Boolean); } catch (_) {}
  }
  // pose detector — lazy (Pose Party / body games)
  let poseLM = null, poseLoading = false, poseLastT = -1;
  async function ensurePose() { if (poseLM || poseLoading) return; poseLoading = true; try { const vision = await FilesetResolver.forVisionTasks(VISION_WASM); poseLM = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1 }); } catch (_) {} poseLoading = false; }
  function stepPose() {
    if (!host.pose.want) return;
    if (!poseLM) { ensurePose(); return; }
    if (localVideo.readyState < 2 || localVideo.currentTime === poseLastT) return;
    poseLastT = localVideo.currentTime;
    try { const r = poseLM.detectForVideo(localVideo, performance.now() + 3); host.pose.lm = (r.landmarks && r.landmarks[0]) ? r.landmarks[0].map((p) => ({ x: 1 - p.x, y: p.y })) : []; } catch (_) {}
  }
  // body-silhouette segmenter — lazy (Hole in the Wall). Fills host.seg.grid with a
  // coarse "person here" occupancy map (display-mirrored to match the canvas).
  let segmenter = null, segLoading = false, segLastT = -1;
  async function ensureSeg() { if (segmenter || segLoading) return; segLoading = true; try { const vision = await FilesetResolver.forVisionTasks(VISION_WASM); segmenter = await ImageSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: SEG_MODEL, delegate: "GPU" }, runningMode: "VIDEO", outputCategoryMask: true, outputConfidenceMasks: false }); } catch (_) {} segLoading = false; }
  function stepSeg() {
    if (!host.seg.want) return;
    if (!segmenter) { ensureSeg(); return; }
    if (localVideo.readyState < 2 || localVideo.currentTime === segLastT) return;
    segLastT = localVideo.currentTime;
    try {
      segmenter.segmentForVideo(localVideo, performance.now() + 5, (res) => {
        const mask = res.categoryMask; if (!mask) return;
        const mw = mask.width, mh = mask.height, arr = mask.getAsUint8Array();
        const gw = host.seg.gw, gh = host.seg.gh, grid = host.seg.grid;
        let person = 0;
        for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
          const rx = Math.min(mw - 1, Math.floor((1 - (gx + 0.5) / gw) * mw)), ry = Math.min(mh - 1, Math.floor((gy + 0.5) / gh * mh));
          const v = arr[ry * mw + rx] || 0; const p = v !== 0 ? 1 : 0; grid[gy * gw + gx] = p; person += p;
        }
        host.seg.count = person;
        if (mask.close) mask.close();
      });
    } catch (_) {}
  }
  return { stepObjects, stepPose, stepSeg };
}
