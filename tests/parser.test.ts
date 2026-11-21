import { describe, it, expect } from "vitest";
import { buildDemoPlaywrightTraceZip } from "../src/demo/fixture.js";
import { parsePlaywrightTraceZip } from "../src/trace/parser.js";

describe("Playwright trace.zip compiler", () => {
  it("parses actions, click coordinates, ARIA captions, and closest screencast frames", () => {
    const zip = buildDemoPlaywrightTraceZip();
    const raw = parsePlaywrightTraceZip(zip, { title: "Onboarding", redactPii: false });
    expect(raw.title).toBe("Onboarding");
    expect(raw.steps).toHaveLength(4);
    expect(raw.steps[0].action).toBe("goto");
    expect(raw.steps[1].title).toContain("dillon@acme-staging.io");
    expect(raw.steps[3].title).toContain('"Create Production Key"');
    expect(raw.steps[3].clickXPercent).toBeCloseTo(50, 0);
    expect(raw.steps[3].frameDataUri).toMatch(/^data:image\/svg\+xml;base64,/);

    const redacted = parsePlaywrightTraceZip(zip, { title: "Onboarding", redactPii: true });
    expect(redacted.redactedTotal).toBeGreaterThanOrEqual(2);
    expect(redacted.steps[1].title).not.toContain("dillon@acme-staging.io");
    expect(redacted.steps[1].title).toContain("[REDACTED_EMAIL]");
    expect(redacted.steps[2].title).not.toContain("sk-live-");
    expect(redacted.steps[2].blurBoxes.length).toBeGreaterThanOrEqual(1);
  });
});
