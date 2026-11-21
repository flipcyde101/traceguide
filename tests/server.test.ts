import { describe, it, expect, afterEach } from "vitest";
import { buildDemoPlaywrightTraceZip } from "../src/demo/fixture.js";
import { startTraceguideServer, type RunningTraceguideServer } from "../src/server/app.js";

describe("self-hosted SQLite guide library server", () => {
  const servers: RunningTraceguideServer[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()!.close();
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
    expect(await htmlRes.text()).toContain("Demo Keys");

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
});
