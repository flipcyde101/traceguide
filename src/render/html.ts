import type { Guide } from "../types.js";
import { renderGuideMarkdown } from "./markdown.js";
import { omitStepScreenshot } from "../redact/pii.js";

const SAFE_RASTER_DATA_URI_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sanitizeEmbedUrl(raw: string | undefined, guideId: string): string {
  const fallback = `https://your-traceguide-host/guides/${encodeURIComponent(guideId)}`;
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export function renderGuideHtml(guide: Guide, opts: { embedUrl?: string; scriptNonce?: string } = {}): string {
  const screenshotsOmitted = guide.screenshotsOmitted !== false;
  const sanitizedGuide: Guide = {
    ...guide,
    screenshotsOmitted,
    steps: guide.steps.map((step) => {
      if (screenshotsOmitted || !step.frameDataUri || !SAFE_RASTER_DATA_URI_RE.test(step.frameDataUri)) {
        return omitStepScreenshot(step);
      }
      return step;
    }),
  };

  const markdown = renderGuideMarkdown(sanitizedGuide);
  const embedSrc = sanitizeEmbedUrl(opts.embedUrl, sanitizedGuide.id);
  const iframeSnippet = `<iframe src="${escapeHtml(embedSrc)}" width="100%" height="640" style="border:1px solid #30363d;border-radius:12px;" loading="lazy"></iframe>`;
  const payload = safeJsonForScript({ guide: sanitizedGuide, markdown, iframeSnippet });
  const nonceAttr = opts.scriptNonce ? ` nonce="${escapeHtml(opts.scriptNonce)}"` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(sanitizedGuide.title)} | traceguide</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    body { margin: 0; background: #0d1117; color: #e6edf3; min-height: 100vh; display: flex; flex-direction: column; }
    header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #30363d; background: #161b22; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .badge { background: #1f6feb22; color: #58a6ff; border: 1px solid #1f6feb55; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .badge.redacted { background: #2ea04322; color: #3fb950; border-color: #2ea04355; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
    button.primary { background: #1f6feb; border-color: #388bfd; color: #fff; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    main { flex: 1; display: grid; grid-template-columns: 300px 1fr; min-height: 0; }
    @media (max-width: 860px) { main { grid-template-columns: 1fr; } }
    aside { border-right: 1px solid #30363d; padding: 12px; overflow-y: auto; max-height: calc(100vh - 64px); }
    .step-item { width: 100%; text-align: left; padding: 10px 12px; margin-bottom: 6px; border-radius: 8px; background: #161b22; border: 1px solid #30363d; color: #e6edf3; }
    .step-item.active { border-color: #58a6ff; background: #1f6feb22; }
    .step-num { font-size: 11px; color: #58a6ff; font-weight: 700; display: block; margin-bottom: 2px; }
    .stage-wrap { padding: 20px; display: flex; flex-direction: column; gap: 14px; align-items: center; }
    .step-header { width: 100%; max-width: 960px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .frame-box { position: relative; width: 100%; max-width: 960px; max-height: 70vh; background: #010409; border: 1px solid #30363d; border-radius: 12px; overflow: hidden; display: grid; place-items: center; }
    .frame-box img { width: 100%; height: 100%; object-fit: fill; display: block; }
    .pulse-ring { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #38bdf8; background: rgba(56, 189, 248, 0.25); box-shadow: 0 0 0 6px rgba(56, 189, 248, 0.22); pointer-events: none; animation: tgPulse 1.5s infinite; }
    @keyframes tgPulse { 0% { transform: scale(0.92); opacity: 1; } 70% { transform: scale(1.35); opacity: 0.3; } 100% { transform: scale(0.92); opacity: 1; } }
    .blur-mask { position: absolute; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); background: rgba(13, 17, 23, 0.72); border: 1px dashed #3fb950; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #3fb950; letter-spacing: 0.04em; }
    .caption-bar { width: 100%; max-width: 960px; background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #8b949e; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <strong>${escapeHtml(sanitizedGuide.title)}</strong>
      <span class="badge">${sanitizedGuide.steps.length} steps</span>
      <span class="badge redacted">${sanitizedGuide.redactedTotal} PII redacted</span>
      ${screenshotsOmitted ? '<span class="badge">Screenshots omitted</span>' : ''}
    </div>
    <div class="actions">
      <button id="copy-md-btn">Copy Markdown</button>
      <button id="copy-iframe-btn">Copy Embed &lt;iframe&gt;</button>
    </div>
  </header>
  <main>
    <aside id="step-list"></aside>
    <section class="stage-wrap">
      <div class="step-header">
        <strong id="step-title"></strong>
        <div class="actions">
          <button id="prev-btn">Prev</button>
          <button id="next-btn" class="primary">Next</button>
        </div>
      </div>
      <div id="frame-box" class="frame-box"></div>
      <div id="caption-bar" class="caption-bar"></div>
    </section>
  </main>
  <script${nonceAttr}>
    const DATA = ${payload};
    const steps = DATA.guide.steps || [];
    let current = 0;

    const listEl = document.getElementById("step-list");
    const titleEl = document.getElementById("step-title");
    const frameEl = document.getElementById("frame-box");
    const captionEl = document.getElementById("caption-bar");
    const prevBtn = document.getElementById("prev-btn");
    const nextBtn = document.getElementById("next-btn");

    function render() {
      listEl.replaceChildren();
      steps.forEach((s, i) => {
        const btn = document.createElement("button");
        btn.className = i === current ? "step-item active" : "step-item";
        const num = document.createElement("span");
        num.className = "step-num";
        num.textContent = "STEP " + s.index;
        const lbl = document.createElement("span");
        lbl.textContent = s.title;
        btn.append(num, lbl);
        btn.addEventListener("click", () => { current = i; render(); });
        listEl.appendChild(btn);
      });

      const step = steps[current];
      if (!step) {
        titleEl.textContent = "No steps found in trace.";
        frameEl.replaceChildren();
        captionEl.textContent = "";
        return;
      }

      titleEl.textContent = "Step " + step.index + " of " + steps.length + ": " + step.title;
      prevBtn.disabled = current <= 0;
      nextBtn.disabled = current >= steps.length - 1;

      if (step.viewportWidth > 0 && step.viewportHeight > 0) {
        frameEl.style.aspectRatio = step.viewportWidth + " / " + step.viewportHeight;
      } else {
        frameEl.style.aspectRatio = "16 / 9";
      }

      frameEl.replaceChildren();
      if (step.frameDataUri && /^data:image\\/(?:png|jpeg|webp);base64,/i.test(step.frameDataUri)) {
        const img = document.createElement("img");
        img.src = step.frameDataUri;
        img.alt = step.title;
        frameEl.appendChild(img);
      } else {
        const empty = document.createElement("div");
        empty.style.color = "#8b949e";
        empty.textContent = DATA.guide.screenshotsOmitted
          ? "Screenshots omitted for privacy"
          : "No screencast frame recorded for this step";
        frameEl.appendChild(empty);
      }

      for (const b of step.blurBoxes || []) {
        const mask = document.createElement("div");
        mask.className = "blur-mask";
        mask.style.left = b.xPercent + "%";
        mask.style.top = b.yPercent + "%";
        mask.style.width = b.wPercent + "%";
        mask.style.height = b.hPercent + "%";
        mask.textContent = "REDACTED (" + b.reason + ")";
        frameEl.appendChild(mask);
      }

      if (typeof step.clickXPercent === "number" && typeof step.clickYPercent === "number") {
        const ring = document.createElement("div");
        ring.className = "pulse-ring";
        ring.style.left = step.clickXPercent + "%";
        ring.style.top = step.clickYPercent + "%";
        frameEl.appendChild(ring);
      }

      captionEl.textContent = step.detail || step.action;
    }

    prevBtn.addEventListener("click", () => { if (current > 0) { current--; render(); } });
    nextBtn.addEventListener("click", () => { if (current < steps.length - 1) { current++; render(); } });
    window.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" && current > 0) { current--; render(); }
      if (e.key === "ArrowRight" && current < steps.length - 1) { current++; render(); }
    });

    async function copyText(btn, text, label) {
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied!";
      } catch {
        btn.textContent = "Copy failed";
      } finally {
        setTimeout(() => { btn.textContent = label; }, 1400);
      }
    }
    document.getElementById("copy-md-btn").addEventListener("click", (e) => copyText(e.target, DATA.markdown, "Copy Markdown"));
    document.getElementById("copy-iframe-btn").addEventListener("click", (e) => copyText(e.target, DATA.iframeSnippet, "Copy Embed <iframe>"));

    render();
  </script>
</body>
</html>`;
}
