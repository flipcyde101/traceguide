import type { BlurBox, Guide, GuideStep } from "../types.js";

const SENSITIVE_SELECTOR_RE = /(?:password|passwd|secret|token|api[-_]?key|ssn|cvv|card[-_]?number|credit[-_]?card)/i;

const PII_PATTERNS: Array<{ name: string; re: RegExp; replacement: string }> = [
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "[REDACTED_EMAIL]" },
  { name: "bearer_token", re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED_JWT]" },
  { name: "openai_key", re: /\bsk-[A-Za-z0-9_-]{12,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { name: "github_token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g, replacement: "[REDACTED_GH_TOKEN]" },
  { name: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
  { name: "card_number", re: /\b(?:\d[ -]*?){13,16}\b/g, replacement: "[REDACTED_CARD]" },
];

export function redactText(text: string): { text: string; count: number; reasons: string[] } {
  let out = text;
  let count = 0;
  const reasons = new Set<string>();

  for (const rule of PII_PATTERNS) {
    rule.re.lastIndex = 0;
    const matches = out.match(rule.re);
    if (matches && matches.length > 0) {
      count += matches.length;
      reasons.add(rule.name);
      out = out.replace(rule.re, rule.replacement);
    }
  }

  return { text: out, count, reasons: [...reasons] };
}

export function isSensitiveSelector(selector: string | undefined): boolean {
  return Boolean(selector && SENSITIVE_SELECTOR_RE.test(selector));
}

export function redactGuideStep(step: GuideStep): GuideStep {
  const blurBoxes: BlurBox[] = [...step.blurBoxes];
  let redactedCount = step.redactedCount;
  let title = step.title;
  let detail = step.detail;

  const sensitiveField = isSensitiveSelector(step.selector);
  if (sensitiveField && (step.action === "fill" || step.action === "type")) {
    title = `Enter sensitive value into ${step.selector ?? "protected field"}`;
    detail = "Value redacted automatically by traceguide --redact-pii.";
    redactedCount += 1;
    blurBoxes.push({
      xPercent: Math.max(2, (step.clickXPercent ?? 50) - 18),
      yPercent: Math.max(2, (step.clickYPercent ?? 50) - 4),
      wPercent: 36,
      hPercent: 8,
      reason: "sensitive-input",
    });
  } else {
    const tRes = redactText(title);
    const dRes = redactText(detail);
    title = tRes.text;
    detail = dRes.text;
    const hits = tRes.count + dRes.count;
    if (hits > 0) {
      redactedCount += hits;
      const reason = [...new Set([...tRes.reasons, ...dRes.reasons])].join(",");
      blurBoxes.push({
        xPercent: Math.max(2, (step.clickXPercent ?? 50) - 18),
        yPercent: Math.max(2, (step.clickYPercent ?? 50) - 4),
        wPercent: 36,
        hPercent: 8,
        reason: reason || "pii",
      });
    }
  }

  return {
    ...step,
    title,
    detail,
    blurBoxes,
    redactedCount,
  };
}

export function redactGuide(guide: Guide): Guide {
  const steps = guide.steps.map((s) => redactGuideStep(s));
  const redactedTotal = steps.reduce((sum, s) => sum + s.redactedCount, 0);
  return {
    ...guide,
    steps,
    redactedTotal,
  };
}
