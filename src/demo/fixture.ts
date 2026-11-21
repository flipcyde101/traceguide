import { deflateSync } from "node:zlib";
import { crc32, createZipBuffer } from "../zip/archive.js";

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function drawRect(
  rgb: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  rw: number,
  rh: number,
  color: [number, number, number]
): void {
  for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) {
      const idx = (y * w + x) * 3;
      rgb[idx] = color[0];
      rgb[idx + 1] = color[1];
      rgb[idx + 2] = color[2];
    }
  }
}

function makeDemoPngFrame(accent: [number, number, number], targetX: number, targetY: number): Buffer {
  const w = 320;
  const h = 180;
  const rgb = new Uint8Array(w * h * 3);
  drawRect(rgb, w, h, 0, 0, w, h, [15, 23, 42]);
  drawRect(rgb, w, h, 0, 0, w, 18, [30, 41, 59]);
  drawRect(rgb, w, h, 42, 30, 236, 124, [30, 41, 59]);
  drawRect(rgb, w, h, 56, 44, 140, 10, [148, 163, 184]);
  const bx = Math.round((targetX / 1280) * w) - 44;
  const by = Math.round((targetY / 720) * h) - 9;
  drawRect(rgb, w, h, bx, by, 88, 18, accent);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = w * 3;
  const raw = Buffer.alloc(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  return Buffer.concat([PNG_SIG, makePngChunk("IHDR", ihdr), makePngChunk("IDAT", deflateSync(raw)), makePngChunk("IEND", Buffer.alloc(0))]);
}

/**
 * Generates a realistic, valid Playwright trace.zip archive containing a 4-step
 * "Create Production API Key" onboarding flow with raster PNG frames, click coordinates, and PII fields.
 */
export function buildDemoPlaywrightTraceZip(): Buffer {
  const frame1 = makeDemoPngFrame([56, 189, 248], 420, 310);
  const frame2 = makeDemoPngFrame([99, 102, 241], 520, 330);
  const frame3 = makeDemoPngFrame([245, 158, 11], 520, 410);
  const frame4 = makeDemoPngFrame([34, 197, 94], 640, 490);

  const traceLines = [
    JSON.stringify({ type: "context-options", options: { viewport: { width: 1280, height: 720 } } }),
    JSON.stringify({ type: "screencast-frame", sha1: "frame1.png", timestamp: 1000, width: 1280, height: 720 }),
    JSON.stringify({ type: "screencast-frame", sha1: "frame2.png", timestamp: 2000, width: 1280, height: 720 }),
    JSON.stringify({ type: "screencast-frame", sha1: "frame3.png", timestamp: 3000, width: 1280, height: 720 }),
    JSON.stringify({ type: "screencast-frame", sha1: "frame4.png", timestamp: 4000, width: 1280, height: 720 }),
    JSON.stringify({
      type: "before",
      callId: "c1",
      method: "goto",
      params: { url: "https://app.acme-staging.io/settings/keys" },
      startTime: 1000,
    }),
    JSON.stringify({
      type: "before",
      callId: "c2",
      method: "fill",
      params: { selector: 'input[placeholder="Work Email"]', value: "dillon@acme-staging.io" },
      startTime: 2000,
    }),
    JSON.stringify({ type: "after", callId: "c2", endTime: 2050, point: { x: 520, y: 330 } }),
    JSON.stringify({
      type: "before",
      callId: "c3",
      method: "fill",
      params: { selector: 'input[name="password"]', value: "sk-live-98432109843210abcdef" },
      startTime: 3000,
    }),
    JSON.stringify({ type: "after", callId: "c3", endTime: 3050, point: { x: 520, y: 410 } }),
    JSON.stringify({
      type: "before",
      callId: "c4",
      method: "click",
      params: { selector: 'role=button[name="Create Production Key"]' },
      startTime: 4000,
    }),
    JSON.stringify({ type: "after", callId: "c4", endTime: 4050, point: { x: 640, y: 490 } }),
  ].join("\n");

  return createZipBuffer([
    { name: "test.trace", data: Buffer.from(traceLines, "utf8") },
    { name: "resources/frame1.png", data: frame1 },
    { name: "resources/frame2.png", data: frame2 },
    { name: "resources/frame3.png", data: frame3 },
    { name: "resources/frame4.png", data: frame4 },
  ]);
}
