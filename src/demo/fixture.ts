import { createZipBuffer } from "../zip/archive.js";

function makeDemoSvgFrame(heading: string, highlightLabel: string, x: number, y: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#0f172a"/>
  <rect x="0" y="0" width="1280" height="64" fill="#1e293b"/>
  <text x="32" y="40" fill="#38bdf8" font-family="sans-serif" font-size="22" font-weight="bold">AcmeCloud Dashboard</text>
  <rect x="180" y="120" width="920" height="480" rx="16" fill="#1e293b" stroke="#334155" stroke-width="2"/>
  <text x="220" y="180" fill="#f8fafc" font-family="sans-serif" font-size="28" font-weight="bold">${heading}</text>
  <rect x="${x - 160}" y="${y - 26}" width="320" height="52" rx="10" fill="#1f6feb"/>
  <text x="${x}" y="${y + 7}" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="18" font-weight="bold">${highlightLabel}</text>
</svg>`;
  return Buffer.from(svg, "utf8");
}

/**
 * Generates a realistic, valid Playwright trace.zip archive containing a 4-step
 * "Create Production API Key" onboarding flow with click coordinates and PII fields.
 */
export function buildDemoPlaywrightTraceZip(): Buffer {
  const frame1 = makeDemoSvgFrame("Workspace Settings", "Open API Keys", 420, 310);
  const frame2 = makeDemoSvgFrame("Verify Account Email", "dillon@acme-staging.io", 520, 330);
  const frame3 = makeDemoSvgFrame("Confirm Master Secret", "sk-live-98432109843210abcdef", 520, 410);
  const frame4 = makeDemoSvgFrame("Key Provisioned", "Create Production Key", 640, 490);

  const traceLines = [
    JSON.stringify({ type: "context-options", options: { viewport: { width: 1280, height: 720 } } }),
    JSON.stringify({ type: "screencast-frame", sha1: "frame1.svg", timestamp: 1000, width: 1280, height: 720 }),
    JSON.stringify({ type: "screencast-frame", sha1: "frame2.svg", timestamp: 2000, width: 1280, height: 720 }),
    JSON.stringify({ type: "screencast-frame", sha1: "frame3.svg", timestamp: 3000, width: 1280, height: 720 }),
    JSON.stringify({ type: "screencast-frame", sha1: "frame4.svg", timestamp: 4000, width: 1280, height: 720 }),
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
    { name: "resources/frame1.svg", data: frame1 },
    { name: "resources/frame2.svg", data: frame2 },
    { name: "resources/frame3.svg", data: frame3 },
    { name: "resources/frame4.svg", data: frame4 },
  ]);
}
