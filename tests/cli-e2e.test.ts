import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("built dist/cli.js --demo end-to-end", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("compiles demo Playwright trace.zip into redacted standalone HTML + Markdown", () => {
    const dir = mkdtempSync(join(tmpdir(), "tg-e2e-"));
    dirs.push(dir);
    const outHtml = join(dir, "demo.html");
    const outMd = join(dir, "demo.md");
    const cliPath = resolve(process.cwd(), "dist", "cli.js");

    const stdout = execFileSync(process.execPath, [cliPath, "--demo", "--out", outHtml, "--markdown", outMd], {
      encoding: "utf8",
    });
    expect(stdout).toContain("4 step(s)");
    expect(existsSync(outHtml)).toBe(true);
    expect(existsSync(outMd)).toBe(true);

    const html = readFileSync(outHtml, "utf8");
    expect(html).toContain("Create Production API Key (Demo)");
    expect(html).not.toContain("dillon@acme-staging.io");
    expect(html).not.toContain("sk-live-");
    const md = readFileSync(outMd, "utf8");
    const unredactedHtml = join(dir, "unredacted.html");
    execFileSync(process.execPath, [cliPath, "--demo", "--no-redact-pii", "--out", unredactedHtml]);
    const originalImages = readFileSync(unredactedHtml, "utf8").match(/data:image\/png;base64,[A-Za-z0-9+/=]+/g) ?? [];
    expect(originalImages).toHaveLength(4);
    expect(html).not.toMatch(/data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+/);
    expect(html).toContain("Screenshots omitted");
    expect(md).toContain("Screenshots omitted");
    for (const originalImage of originalImages) {
      expect(html.includes(originalImage)).toBe(false);
      expect(md.includes(originalImage)).toBe(false);
    }
  });
});
