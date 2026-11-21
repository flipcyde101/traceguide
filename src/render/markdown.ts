import type { Guide } from "../types.js";

function mdCode(text: string): string {
  const safe = text.replace(/\r?\n/g, " ");
  const runs = safe.match(/`+/g);
  const maxRun = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  const fence = "`".repeat(maxRun + 1);
  return safe.startsWith("`") || safe.endsWith("`") ? `${fence} ${safe} ${fence}` : `${fence}${safe}${fence}`;
}

function sanitizeHeading(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
}

export function renderGuideMarkdown(guide: Guide): string {
  const lines: string[] = [
    `# ${sanitizeHeading(guide.title)}`,
    "",
    `- **Steps:** ${guide.steps.length}`,
    `- **Viewport:** ${guide.viewportWidth}x${guide.viewportHeight}`,
    `- **Redacted PII items:** ${guide.redactedTotal}`,
    "",
  ];

  for (const step of guide.steps) {
    lines.push(`## Step ${step.index}: ${sanitizeHeading(step.title)}`);
    lines.push("");
    if (step.detail) {
      lines.push(sanitizeHeading(step.detail));
      lines.push("");
    }
    const meta: string[] = [`Action: ${mdCode(step.action)}`];
    if (step.selector) meta.push(`Selector: ${mdCode(step.selector)}`);
    if (step.clickXPercent !== undefined && step.clickYPercent !== undefined) {
      meta.push(`Click: (${step.clickXPercent.toFixed(1)}%, ${step.clickYPercent.toFixed(1)}%)`);
    }
    if (step.blurBoxes.length > 0) {
      meta.push(`Blurred regions: ${step.blurBoxes.length}`);
    }
    lines.push(`_${meta.join(" | ")}_`);
    lines.push("");
  }

  lines.push("---");
  lines.push("_Generated with [traceguide](https://github.com/flipcyde101/traceguide)_");
  return lines.join("\n");
}
