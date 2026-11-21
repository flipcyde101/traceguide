import { describe, it, expect, afterEach } from "vitest";
import { buildDemoPlaywrightTraceZip } from "../src/demo/fixture.js";
import { startTraceguideServer, type RunningTraceguideServer } from "../src/server/app.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parsePlaywrightTraceZip } from "../src/trace/parser.js";

describe("self-hosted SQLite guide library server", () => {
  const servers: RunningTraceguideServer[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()!.close();
    }
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("uploads trace.zip, lists guides, renders interactive player & Markdown, edits steps/blurs, and deletes cleanly", async () => {
    const srv = await startTraceguideServer({ port: 0, dbPath: ":memory:" });
    servers.push(srv);

    const zip = buildDemoPlaywrightTraceZip();
    const up = await fetch(`${srv.url}/api/guides/upload?title=Demo+Keys&redact=1`, {
      method: "POST",
      body: new Uint8Array(zip),
    });
    expect(up.status).toBe(201);
    const created = (await up.json()) as { id: string; stepCount: number; redactedTotal: number };
    expect(created.stepCount).toBe(4);
    expect(created.redactedTotal).toBeGreaterThanOrEqual(2);

    const listRes = await fetch(`${srv.url}/api/guides`);
    const list = (await listRes.json()) as Array<{ id: string }>;
    expect(list).toHaveLength(1);

    const htmlRes = await fetch(`${srv.url}/guides/${created.id}`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain("Demo Keys");
    expect(html).toContain("Screenshots omitted");
    expect(html).not.toMatch(/data:image\/png;base64,[A-Za-z0-9+/=]+/);

    const mdRes = await fetch(`${srv.url}/guides/${created.id}/markdown`);
    expect(mdRes.status).toBe(200);
    expect(await mdRes.text()).toContain("# Demo Keys");

    const patchRes = await fetch(`${srv.url}/api/guides/${created.id}/steps/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Open Workspace API Settings",
        blurBoxes: [{ xPercent: 10, yPercent: 20, wPercent: 30, hPercent: 10, reason: "manual" }],
      }),
    });
    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as { title: string }).title).toBe("Open Workspace API Settings");

    const delRes = await fetch(`${srv.url}/api/guides/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
  });

  it("withholds frames from legacy library exports and edits while retaining new explicit opt-outs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "traceguide-legacy-test-"));
    dirs.push(dir);
    const dbPath = join(dir, "library.db");
    const srv = await startTraceguideServer({ port: 0, dbPath });
    servers.push(srv);
    const zip = buildDemoPlaywrightTraceZip();
    const legacy = parsePlaywrightTraceZip(zip, { redactPii: false });
    const originalFrame = legacy.steps[0].frameDataUri!;
    expect(originalFrame.startsWith("data:image/png;base64,")).toBe(true);
    delete legacy.screenshotsOmitted;
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("INSERT INTO guides (id, title, created_at, guide_json) VALUES (?, ?, ?, ?)")
        .run(legacy.id, legacy.title, legacy.createdAt, JSON.stringify(legacy));
    } finally {
      db.close();
    }
    const legacyHtml = await (await fetch(`${srv.url}/guides/${legacy.id}`)).text();
    expect(legacyHtml.includes(originalFrame)).toBe(false);
    expect(legacyHtml).toContain("Screenshots omitted");
    const edited = await fetch(`${srv.url}/api/guides/${legacy.id}/steps/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Edited demo step" }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).not.toHaveProperty("frameDataUri");

    const raw = await fetch(`${srv.url}/api/guides/upload?redact=0`, { method: "POST", body: new Uint8Array(zip) });
    expect(raw.status).toBe(201);
    const { id } = await raw.json() as { id: string };
    const rawHtml = await (await fetch(`${srv.url}/guides/${id}`)).text();
    expect(rawHtml.includes(originalFrame)).toBe(true);
  });
});
