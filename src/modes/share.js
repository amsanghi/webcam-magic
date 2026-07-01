// share.js — the "Shacam" mode: quickly share images, PDFs, or a window/screen
// over your webcam and manipulate them with your hands like physical objects.
//   • pinch        → grab & move
//   • two hands    → spread to resize, twist to rotate
//   • open-palm swipe → flip PDF pages
// Content + live transforms are synced to the partner over Trystero so they see
// what you're presenting on your half of the call. Everything stays client-side.

import * as FX from "../fx/effects.js";
const { W, H, MID, toCanvas } = FX;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const PDF_VER = "4.7.76";
let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_VER}/build/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDF_VER}/build/pdf.worker.min.mjs`;
  return pdfjs;
}

// downscale any drawable to a JPEG data URL for syncing to the partner
function toDataURL(src, natW, natH, max = 720, q = 0.6) {
  const sc = Math.min(1, max / Math.max(natW, natH));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(natW * sc)); c.height = Math.max(1, Math.round(natH * sc));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  try { return c.toDataURL("image/jpeg", q); } catch (_) { return null; }   // tainted (cross-origin) → skip
}

export function createShareMode(net, sideFn) {
  const mine = () => (sideFn ? sideFn() : 0);   // this client's fixed side (0=left)
  return function shareMode() {
    let panels = [];                 // {id,kind,src,natW,natH,cx,cy,scale,rot,pdf,remote,active}
    let counter = 0, grabbed = null, prevSpread = null, prevTwist = null;
    let lastPalmX = null, lastFlip = 0, lastSync = 0, lastFrame = 0;
    const newId = () => "p" + (++counter) + "_" + Math.floor(Math.random() * 1e6);
    const active = () => panels.filter((p) => !p.remote).slice(-1)[0] || null;

    function pxRect(p) {
      const c = toCanvas({ x: p.cx, y: p.cy }, p.remote ? 1 - mine() : mine());
      const w = p.scale * MID, h = w * (p.natH / p.natW);
      return { cx: c.x, cy: c.y, w, h };
    }

    function addLocal(kind, src, natW, natH, pdf) {
      const p = { id: newId(), kind, src, natW, natH, cx: 0.5, cy: 0.42, scale: 0.62, rot: 0, pdf, remote: false };
      panels.push(p);
      const url = toDataURL(src, natW, natH);
      if (url) net.send({ t: "share-add", id: p.id, img: url, natW, natH, cx: p.cx, cy: p.cy, scale: p.scale, rot: p.rot });
      return p;
    }

    // ---- file / capture pickers -----------------------------------------
    function pick(accept, cb) {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = accept;
      inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); };
      inp.click();
    }
    function addImage() {
      pick("image/*", (file) => {
        const img = new Image();
        img.onload = () => addLocal("image", img, img.naturalWidth, img.naturalHeight);
        img.src = URL.createObjectURL(file);
      });
    }
    async function addPdf() {
      pick("application/pdf,.pdf", async (file) => {
        try {
          const lib = await loadPdfjs();
          const buf = await file.arrayBuffer();
          const doc = await lib.getDocument({ data: buf }).promise;
          const cv = await renderPdf(doc, 1);
          const p = addLocal("pdf", cv, cv.width, cv.height, { doc, page: 1, num: doc.numPages });
        } catch (e) { console.warn("[share] pdf failed", e); }
      });
    }
    async function renderPdf(doc, n) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 2 });
      const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      return cv;
    }
    async function flipPdf(dir) {
      const p = active(); if (!p || p.kind !== "pdf") return;
      const next = clamp(p.pdf.page + dir, 1, p.pdf.num); if (next === p.pdf.page) return;
      p.pdf.page = next;
      const cv = await renderPdf(p.pdf.doc, next);
      p.src = cv; p.natW = cv.width; p.natH = cv.height;
      const url = toDataURL(cv, cv.width, cv.height);
      if (url) net.send({ t: "share-frame", id: p.id, img: url, natW: cv.width, natH: cv.height });
      FX.Sound.pop();
    }
    async function addWindow() {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const v = document.createElement("video"); v.srcObject = stream; v.autoplay = true; v.playsInline = true; v.muted = true;
        await v.play();
        const p = { id: newId(), kind: "video", src: v, natW: v.videoWidth || 1280, natH: v.videoHeight || 720, cx: 0.5, cy: 0.42, scale: 0.7, rot: 0, remote: false, stream };
        panels.push(p);
        stream.getVideoTracks()[0].addEventListener("ended", () => removePanel(p.id));
      } catch (_) {}
    }
    function removePanel(id) {
      const p = panels.find((x) => x.id === id);
      if (p && p.stream) p.stream.getTracks().forEach((t) => t.stop());
      panels = panels.filter((x) => x.id !== id);
      net.send({ t: "share-remove", id });
    }
    function removeActive() { const p = active(); if (p) removePanel(p.id); }

    return {
      enter() { panels = []; },
      exit() {
        panels.forEach((p) => { if (!p.remote) net.send({ t: "share-remove", id: p.id }); if (p.stream) p.stream.getTracks().forEach((t) => t.stop()); });
        panels = [];
      },
      action(a) {
        if (a === "image") addImage();
        else if (a === "pdf") addPdf();
        else if (a === "window") addWindow();
        else if (a === "next") flipPdf(1);
        else if (a === "prev") flipPdf(-1);
        else if (a === "remove") removeActive();
      },
      onNet(m) {
        if (m.t === "share-add") {
          const img = new Image(); img.src = m.img;
          const ex = panels.find((p) => p.id === m.id);
          const p = ex || { id: m.id, kind: "image", remote: true };
          Object.assign(p, { kind: "image", src: img, natW: m.natW, natH: m.natH, cx: m.cx, cy: m.cy, scale: m.scale, rot: m.rot, remote: true });
          if (!ex) panels.push(p);
        } else if (m.t === "share-frame") {
          const p = panels.find((x) => x.id === m.id); if (p) { const img = new Image(); img.src = m.img; img.onload = () => { p.src = img; p.natW = m.natW; p.natH = m.natH; }; }
        } else if (m.t === "share-move") {
          const p = panels.find((x) => x.id === m.id); if (p) { p.cx = m.cx; p.cy = m.cy; p.scale = m.scale; p.rot = m.rot; }
        } else if (m.t === "share-remove") {
          panels = panels.filter((x) => x.id !== m.id);
        }
      },
      update(dt, local) {
        const t = performance.now();
        const pinch = local && local.pinch && local.pinch.active;
        const cp = pinch ? toCanvas(local.pinch, mine()) : null;

        // grab / move
        if (pinch && cp) {
          if (grabbed == null) {
            for (let i = panels.length - 1; i >= 0; i--) {
              const p = panels[i]; if (p.remote) continue;
              const r = pxRect(p);
              if (Math.abs(cp.x - r.cx) < r.w / 2 && Math.abs(cp.y - r.cy) < r.h / 2) { grabbed = p.id; panels.push(panels.splice(i, 1)[0]); break; }
            }
          }
          const p = panels.find((x) => x.id === grabbed);
          if (p) { p.cx = clamp((cp.x - mine() * MID) / MID, 0, 1); p.cy = clamp(cp.y / H, 0, 1); }
        } else grabbed = null;

        // two-hand spread→scale, twist→rotate on the active/grabbed panel
        const p = panels.find((x) => x.id === grabbed) || active();
        if (p && !p.remote && local && local.two && local.two.spread.active) {
          if (prevSpread != null) p.scale = clamp(p.scale * (1 + (local.two.spread.dist - prevSpread) * 2.2), 0.12, 1.6);
          if (prevTwist != null) { let d = local.two.twist.angle - prevTwist; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.rot += d; }
          prevSpread = local.two.spread.dist; prevTwist = local.two.twist.angle;
        } else { prevSpread = prevTwist = null; }

        // open-palm swipe → flip PDF pages
        if (local && local.palm && local.poses && local.poses.palm) {
          if (lastPalmX != null) { const dx = local.palm.x - lastPalmX; if (Math.abs(dx) > 0.05 && t - lastFlip > 600) { flipPdf(dx > 0 ? 1 : -1); lastFlip = t; } }
          lastPalmX = local.palm.x;
        } else lastPalmX = null;

        // sync transforms (throttled) + live window frames (low fps)
        if (t - lastSync > 110) {
          lastSync = t;
          for (const q of panels) if (!q.remote) net.send({ t: "share-move", id: q.id, cx: q.cx, cy: q.cy, scale: q.scale, rot: q.rot });
        }
        if (t - lastFrame > 320) {
          lastFrame = t;
          for (const q of panels) if (!q.remote && q.kind === "video" && q.src.readyState >= 2) {
            const url = toDataURL(q.src, q.src.videoWidth, q.src.videoHeight, 480, 0.5);
            if (url) net.send({ t: "share-frame", id: q.id, img: url, natW: q.src.videoWidth, natH: q.src.videoHeight });
          }
        }
      },
      draw(ctx) {
        for (const p of panels) {
          if (!p.src) continue;
          const r = pxRect(p);
          ctx.save();
          ctx.translate(r.cx, r.cy); ctx.rotate(p.rot);
          ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = (p.id === grabbed) ? 30 : 12; ctx.shadowOffsetY = 6;
          ctx.fillStyle = "#000"; ctx.fillRect(-r.w / 2 - 4, -r.h / 2 - 4, r.w + 8, r.h + 8);
          try { ctx.drawImage(p.src, -r.w / 2, -r.h / 2, r.w, r.h); } catch (_) {}
          ctx.shadowBlur = 0;
          ctx.strokeStyle = p.id === grabbed ? "#7c8bff" : "rgba(255,255,255,.35)";
          ctx.lineWidth = p.id === grabbed ? 3 : 1.5; ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
          if (p.kind === "pdf" && !p.remote) { ctx.rotate(-p.rot); ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(-r.w / 2, r.h / 2 - 24, 92, 24); ctx.fillStyle = "#fff"; ctx.font = "13px system-ui"; ctx.textAlign = "left"; ctx.fillText(`pg ${p.pdf.page}/${p.pdf.num}`, -r.w / 2 + 8, r.h / 2 - 7); }
          ctx.restore();
        }
        ctx.save(); ctx.globalAlpha = 0.7; ctx.fillStyle = "#fff"; ctx.font = "15px system-ui"; ctx.textAlign = "center";
        ctx.fillText("Share — add image/PDF/window, then pinch to move • two hands to resize/rotate • swipe palm to flip PDF pages", W / 2, H - 24);
        ctx.restore();
      },
    };
  };
}
