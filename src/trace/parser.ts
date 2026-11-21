import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import { redactGuide } from "../redact/pii.js";
import type { Guide, GuideStep, TraceParseOptions } from "../types.js";
import { readZipBuffer } from "../zip/archive.js";

interface TraceEvent {
  type?: unknown;
  callId?: unknown;
  apiName?: unknown;
  method?: unknown;
  params?: Record<string, unknown>;
  startTime?: unknown;
  endTime?: unknown;
  timestamp?: unknown;
  point?: { x?: number; y?: number };
  sha1?: unknown;
  width?: unknown;
  height?: unknown;
  options?: { viewport?: { width?: number; height?: number } };
}

interface ScreencastFrame {
  timestamp: number;
  sha1: string;
  width: number;
  height: number;
}

const INTERACTIVE_METHODS = new Set([
  "goto",
  "click",
  "dblclick",
  "fill",
  "type",
  "press",
  "check",
  "uncheck",
  "selectOption",
]);

/**
 * Only allow safe raster image formats (PNG, JPEG, WebP) from untrusted trace archives.
 */
function detectRasterImageMime(buf: Buffer): string | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function cleanSelectorLabel(selector: string | undefined): string {
  if (!selector) return "element";
  const nameAttr = /name=["']([^"']+)["']/i.exec(selector);
  if (nameAttr) return `"${nameAttr[1]}"`;
  const textSel = /(?:^|>>)text=["']?([^"'>]+)["']?/i.exec(selector);
  if (textSel) return `"${textSel[1].trim()}"`;
  const placeholder = /placeholder=["']([^"']+)["']/i.exec(selector);
  if (placeholder) return `"${placeholder[1]}"`;
  const label = /aria-label=["']([^"']+)["']/i.exec(selector);
  if (label) return `"${label[1]}"`;
  const idMatch = /^#([A-Za-z0-9_-]+)$/.exec(selector.trim());
  if (idMatch) return `"${idMatch[1].replace(/[-_]+/g, " ")}"`;
  return selector.slice(0, 80);
}

function formatActionTitle(method: string, params: Record<string, unknown>): { title: string; detail: string } {
  const selector = typeof params.selector === "string" ? params.selector : undefined;
  const label = cleanSelectorLabel(selector);

  if (method === "goto") {
    const url = typeof params.url === "string" ? params.url : "page";
    return { title: `Open ${url}`, detail: `Navigate to ${url}` };
  }
  if (method === "click" || method === "dblclick") {
    const verb = method === "dblclick" ? "Double-click" : "Click";
    return { title: `${verb} ${label}`, detail: selector ? `Selector: ${selector}` : verb };
  }
  if (method === "fill" || method === "type") {
    const val = typeof params.value === "string" ? params.value : typeof params.text === "string" ? params.text : "";
    return {
      title: `Type "${val}" into ${label}`,
      detail: selector ? `Input ${selector} set to "${val}"` : `Typed "${val}"`,
    };
  }
  if (method === "press") {
    const key = typeof params.key === "string" ? params.key : "key";
    return { title: `Press ${key} on ${label}`, detail: `Keyboard input: ${key}` };
  }
  if (method === "check" || method === "uncheck") {
    return { title: `${method === "check" ? "Check" : "Uncheck"} ${label}`, detail: selector ?? method };
  }
  if (method === "selectOption") {
    return { title: `Select option in ${label}`, detail: selector ?? method };
  }
  return { title: `${method} ${label}`, detail: selector ?? method };
}

function findClosestFrame(frames: ScreencastFrame[], targetTs: number): ScreencastFrame | null {
  if (frames.length === 0) return null;
  let best = frames[0];
  let bestDiff = Math.abs(frames[0].timestamp - targetTs);
  for (let i = 1; i < frames.length; i++) {
    const diff = Math.abs(frames[i].timestamp - targetTs);
    if (diff < bestDiff) {
      best = frames[i];
      bestDiff = diff;
    }
  }
  return best;
}

export function parsePlaywrightTraceZip(zipBuf: Buffer, opts: TraceParseOptions = {}): Guide {
  const entries = readZipBuffer(zipBuf);
  const primaryTraceNames = [...entries.keys()].filter((name) => name.endsWith(".trace"));
  const fallbackTraceNames = [...entries.keys()].filter(
    (name) => !name.endsWith(".network") && name.includes("trace") && name.endsWith(".json")
  );
  const filesToParse = primaryTraceNames.length > 0 ? primaryTraceNames : fallbackTraceNames;

  if (filesToParse.length === 0) {
    throw new Error("No Playwright .trace NDJSON file found inside ZIP archive.");
  }

  let viewportWidth = 1280;
  let viewportHeight = 720;
  const frames: ScreencastFrame[] = [];
  const actionsByKey = new Map<string, { method: string; ev: TraceEvent }>();
  const orderedKeys: string[] = [];

  for (const fileName of filesToParse) {
    const text = entries.get(fileName)!.toString("utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      let ev: TraceEvent;
      try {
        ev = JSON.parse(line) as TraceEvent;
      } catch {
        continue;
      }
      if (!ev || typeof ev !== "object") continue;

      if (ev.type === "context-options" && ev.options?.viewport) {
        if (typeof ev.options.viewport.width === "number" && ev.options.viewport.width > 0) {
          viewportWidth = ev.options.viewport.width;
        }
        if (typeof ev.options.viewport.height === "number" && ev.options.viewport.height > 0) {
          viewportHeight = ev.options.viewport.height;
        }
        continue;
      }

      if (ev.type === "screencast-frame" && typeof ev.sha1 === "string" && ev.sha1.length > 0) {
        const resBuf = entries.get(`resources/${ev.sha1}`) ?? entries.get(ev.sha1);
        // Only register frames whose raster image actually exists in the archive
        if (resBuf && detectRasterImageMime(resBuf)) {
          frames.push({
            timestamp: typeof ev.timestamp === "number" ? ev.timestamp : 0,
            sha1: ev.sha1,
            width: typeof ev.width === "number" && ev.width > 0 ? ev.width : viewportWidth,
            height: typeof ev.height === "number" && ev.height > 0 ? ev.height : viewportHeight,
          });
        }
        continue;
      }

      if (ev.type === "before" || ev.type === "action") {
        const method =
          typeof ev.method === "string"
            ? ev.method
            : typeof ev.apiName === "string"
              ? ev.apiName.split(".").pop()
              : undefined;
        if (!method || !INTERACTIVE_METHODS.has(method)) continue;
        const rawCallId = typeof ev.callId === "string" && ev.callId ? ev.callId : `step-${orderedKeys.length + 1}`;
        const key = `${fileName}::${rawCallId}`;
        const existing = actionsByKey.get(key);
        if (existing) {
          // Merge fields instead of duplicating steps on duplicate callId (e.g. before + action)
          existing.ev = { ...existing.ev, ...ev, params: { ...(existing.ev.params ?? {}), ...(ev.params ?? {}) } };
        } else {
          actionsByKey.set(key, { method, ev });
          orderedKeys.push(key);
        }
        continue;
      }

      if ((ev.type === "after" || ev.type === "input") && typeof ev.callId === "string" && ev.callId) {
        const key = `${fileName}::${ev.callId}`;
        const existing = actionsByKey.get(key);
        if (existing) {
          if (ev.point) existing.ev.point = ev.point;
          if (typeof ev.endTime === "number") existing.ev.endTime = ev.endTime;
        }
      }
    }
  }

  frames.sort((a, b) => a.timestamp - b.timestamp);

  const maxSteps = opts.maxSteps ?? 100;
  const steps: GuideStep[] = [];
  let idx = 1;

  for (const key of orderedKeys) {
    if (steps.length >= maxSteps) break;
    const { method, ev } = actionsByKey.get(key)!;
    const params = ev.params && typeof ev.params === "object" ? ev.params : {};
    const ts =
      typeof ev.endTime === "number"
        ? ev.endTime
        : typeof ev.startTime === "number"
          ? ev.startTime
          : typeof ev.timestamp === "number"
            ? ev.timestamp
            : 0;
    const { title, detail } = formatActionTitle(method, params);
    const frame = findClosestFrame(frames, ts);

    let frameMime: string | undefined;
    let frameDataUri: string | undefined;
    const stepW = frame?.width ?? viewportWidth;
    const stepH = frame?.height ?? viewportHeight;

    if (frame) {
      const resKey = `resources/${frame.sha1}`;
      const rawImg = entries.get(resKey) ?? entries.get(frame.sha1);
      if (rawImg) {
        const mime = detectRasterImageMime(rawImg);
        if (mime) {
          frameMime = mime;
          frameDataUri = `data:${mime};base64,${rawImg.toString("base64")}`;
        }
      }
    }

    const pt = ev.point ?? (params.position as { x?: number; y?: number } | undefined);
    const clickXPercent =
      pt && typeof pt.x === "number" && Number.isFinite(pt.x)
        ? Math.max(0, Math.min(100, (pt.x / Math.max(1, stepW)) * 100))
        : undefined;
    const clickYPercent =
      pt && typeof pt.y === "number" && Number.isFinite(pt.y)
        ? Math.max(0, Math.min(100, (pt.y / Math.max(1, stepH)) * 100))
        : undefined;

    steps.push({
      index: idx++,
      action: method,
      title,
      detail,
      selector: typeof params.selector === "string" ? params.selector : undefined,
      url: typeof params.url === "string" ? params.url : undefined,
      timestampMs: ts,
      clickXPercent,
      clickYPercent,
      viewportWidth: stepW,
      viewportHeight: stepH,
      frameMime,
      frameDataUri,
      blurBoxes: [],
      redactedCount: 0,
    });
  }

  const baseName = opts.sourceFile ? basename(opts.sourceFile, ".zip") : "Interactive Guide";
  const guide: Guide = {
    id: randomBytes(6).toString("hex"),
    title: opts.title?.trim() || baseName,
    sourceFile: opts.sourceFile ?? "trace.zip",
    createdAt: new Date().toISOString(),
    viewportWidth,
    viewportHeight,
    redactedTotal: 0,
    steps,
  };

  return opts.redactPii ? redactGuide(guide) : guide;
}
