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
  });
});
