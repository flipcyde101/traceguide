import { describe, it, expect } from "vitest";
import { buildDemoPlaywrightTraceZip } from "../src/demo/fixture.js";
import { parsePlaywrightTraceZip } from "../src/trace/parser.js";
import { renderGuideHtml } from "../src/render/html.js";
import { renderGuideMarkdown } from "../src/render/markdown.js";

describe("HTML player & Markdown exporter", () => {
  it("escapes </script> and XSS payloads safely in HTML output and formats clean Markdown", () => {
    const guide = parsePlaywrightTraceZip(buildDemoPlaywrightTraceZip(), {
      title: 'Guide </script><img src=x onerror=alert(1)>',
      redactPii: true,
    });
    const html = renderGuideHtml(guide);
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script");
    expect(html).toContain("Copy Markdown");
    expect(html).toContain("pulse-ring");
    expect(html).toContain("blur-mask");

    const md = renderGuideMarkdown(guide);
    expect(md).toContain("## Step 1:");
    expect(md).toContain("Generated with [traceguide]");
  });
});
