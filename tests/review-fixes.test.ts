import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createZipBuffer, readZipBuffer } from "../src/zip/archive.js";
import { parsePlaywrightTraceZip } from "../src/trace/parser.js";
import { redactText } from "../src/redact/pii.js";
import { renderGuideHtml } from "../src/render/html.js";
import { startTraceguideServer, type RunningTraceguideServer } from "../src/server/app.js";
import { parseCliArgs } from "../src/cli.js";
import { buildDemoPlaywrightTraceZip } from "../src/demo/fixture.js";

describe("traceguide whole-branch review regression fixes (C1-C3, I1-I12, M1-M6)", () => {
  const servers: RunningTraceguideServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) await servers.pop()!.close();
  });

  it("C1 & M3: redacts step.url query secrets, step.selector, and demo frames without falsely redacting 13-digit timestamps", () => {
    const trace = [
      JSON.stringify({ type: "context-options", options: { viewport: { width: 390, height: 844 } } }),
      JSON.stringify({
        type: "before",
        callId: "c1",
        method: "goto",
        params: { url: "https://app.example.com/cb?token=supersecret99&api_key=abc123456&ts=1732200000000" },
        startTime: 1000,
      }),
      JSON.stringify({
        type: "before",
        callId: "c2",
        method: "click",
        params: { selector: 'text="alice@corp.com"' },
        startTime: 2000,
      }),
    ].join("\n");

    const zip = createZipBuffer([{ name: "test.trace", data: Buffer.from(trace, "utf8") }]);
    const guide = parsePlaywrightTraceZip(zip, { redactPii: true });

    expect(guide.steps[0].url).not.toContain("supersecret99");
    expect(guide.steps[0].url).not.toContain("abc123456");
    expect(guide.steps[0].title).not.toContain("supersecret99");
    expect(guide.steps[1].selector).not.toContain("alice@corp.com");

    // M3: 13-digit epoch timestamp should NOT trigger card_number false positive
    const tsCheck = redactText("timestamp 1732200000000 order 9001234567891");
    expect(tsCheck.count).toBe(0);

    // Redacted fixtures must not include the original raster frames.
    const demoGuide = parsePlaywrightTraceZip(buildDemoPlaywrightTraceZip(), { redactPii: true });
    expect(demoGuide.steps.every((step) => !step.frameDataUri && !step.frameMime)).toBe(true);
  });

  it("C2, I1, I2: enforces CRC32 integrity on read and handles ZIP comments containing EOCD bytes", () => {
    const zip = createZipBuffer([{ name: "a.txt", data: Buffer.from("hello world", "utf8") }]);
    // Corrupt 1 byte in the compressed payload to trigger CRC32 or inflate mismatch
    const corrupted = Buffer.from(zip);
    corrupted[30 + 5] ^= 0xff;
    expect(() => readZipBuffer(corrupted)).toThrow();

    // Append a ZIP comment containing fake EOCD bytes `PK\x05\x06`
    const fakeComment = Buffer.concat([Buffer.from("note "), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.from(" end")]);
    const withComment = Buffer.concat([zip, fakeComment]);
    // Update EOCD comment length at zip.length - 2
    withComment.writeUInt16LE(fakeComment.length, zip.length - 2);
    const parsed = readZipBuffer(withComment);
    expect(parsed.get("a.txt")?.toString("utf8")).toBe("hello world");
  });

  it("I6 & I7: handles duplicate callIds without duplicating steps and ignores missing screencast-frame resources", () => {
    // 1x1 valid PNG
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    const trace = [
      JSON.stringify({ type: "screencast-frame", sha1: "valid.png", timestamp: 1000, width: 800, height: 600 }),
      JSON.stringify({ type: "screencast-frame", sha1: "missing.png", timestamp: 1005, width: 800, height: 600 }),
      JSON.stringify({ type: "before", callId: "c1", method: "click", params: { selector: "#a" }, startTime: 1004 }),
      JSON.stringify({ type: "action", callId: "c1", method: "click", params: { selector: "#a" }, startTime: 1004 }),
    ].join("\n");
    const zip = createZipBuffer([
      { name: "test.trace", data: Buffer.from(trace, "utf8") },
      { name: "resources/valid.png", data: tinyPng },
    ]);
    const guide = parsePlaywrightTraceZip(zip);
    expect(guide.steps).toHaveLength(1);
    expect(guide.steps[0].frameDataUri).toMatch(/^data:image\/png;base64,/);
  });

  it("I4, I5, I8, I9, C3: server sets CSP/nosniff, ignores poisoned Host header in embedUrl, rejects null PATCH cleanly, and player uses dynamic aspectRatio", async () => {
    const srv = await startTraceguideServer({ port: 0, dbPath: ":memory:" });
    servers.push(srv);

    const up = await fetch(`${srv.url}/api/guides/upload?title=Test`, {
      method: "POST",
      body: new Uint8Array(buildDemoPlaywrightTraceZip()),
    });
    expect(up.status).toBe(201);
    const created = (await up.json()) as { id: string };

    // I4 & I5: poisoned Host header must NOT leak into iframe embed snippet, and CSP/nosniff must be set
    const htmlRes = await fetch(`${srv.url}/guides/${created.id}`, {
      headers: { Host: "evil.attacker.example" },
    });
    expect(htmlRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(htmlRes.headers.get("content-security-policy")).toContain("default-src");
    const html = await htmlRes.text();
    expect(html).not.toContain("evil.attacker.example");
    // I8: dynamic aspect ratio in player JS
    expect(html).toContain("aspectRatio");

    // I9: PATCH with null JSON body must return 400 (not crash or leak raw V8 error)
    const badPatch = await fetch(`${srv.url}/api/guides/${created.id}/steps/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    expect(badPatch.status).toBe(400);
  });

  it("I11, I12, M4: rejects whitespace CLI args & conflicting modes, pins action.yml version, and runs Dockerfile as non-root node", () => {
    expect(() => parseCliArgs(["build", "a.zip", "--out", "   "])).toThrow();
    expect(() => parseCliArgs(["serve", "--port", "   "])).toThrow();
    expect(() => parseCliArgs(["build", "a.zip", "serve"])).toThrow();

    const actionYml = readFileSync(join(process.cwd(), "action.yml"), "utf8");
    expect(actionYml).toContain("traceguide@0.1.1");
    const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
    expect(dockerfile).toContain("USER node");
    const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf8");
    expect(compose).toContain("127.0.0.1:4320:4320");
  });
});
