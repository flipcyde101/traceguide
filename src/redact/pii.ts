import type { BlurBox, Guide, GuideStep } from "../types.js";

const SENSITIVE_SELECTOR_RE =
  /(?:password|passwd|pwd|passphrase|secret|token|api[-_]?key|private[-_]?key|otp|mfa|pin|cookie|ssn|cvv|card[-_]?number|credit[-_]?card)/i;

const SENSITIVE_QUERY_PARAM_RE =
  /([?&](?:token|access_token|id_token|refresh_token|api[-_]?key|key|secret|password|passwd|auth|code|session|email)=)([^&#\s]+)/gi;

const PII_PATTERNS: Array<{ name: string; re: RegExp; replacement: string }> = [
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "[REDACTED_EMAIL]" },
  { name: "bearer_token", re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED_JWT]" },
  { name: "openai_key", re: /\bsk-[A-Za-z0-9_-]{12,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { name: "github_token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g, replacement: "[REDACTED_GH_TOKEN]" },
  { name: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
];

function isValidLuhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function redactText(text: string): { text: string; count: number; reasons: string[] } {
  let out = text;
  let count = 0;
  const reasons = new Set<string>();

  // Redact sensitive URL query parameter values first
  SENSITIVE_QUERY_PARAM_RE.lastIndex = 0;
  out = out.replace(SENSITIVE_QUERY_PARAM_RE, (_full, prefix: string) => {
    count++;
    reasons.add("query_secret");
    return `${prefix}[REDACTED_SECRET]`;
  });

  for (const rule of PII_PATTERNS) {
    rule.re.lastIndex = 0;
    const matches = out.match(rule.re);
    if (matches && matches.length > 0) {
      count += matches.length;
      reasons.add(rule.name);
      out = out.replace(rule.re, rule.replacement);
    }
  }

  // Luhn-validated payment card redaction (avoids false positives on 13-digit timestamps/order IDs)
  out = out.replace(/\b(?:\d[ -]?){13,16}\b/g, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 16 && /^[3456]/.test(digits) && isValidLuhn(digits)) {
      count++;
      reasons.add("card_number");
      return "[REDACTED_CARD]";
    }
    return candidate;
  });

  return { text: out, count, reasons: [...reasons] };
}

export function isSensitiveSelector(selector: string | undefined): boolean {
  return Boolean(selector && SENSITIVE_SELECTOR_RE.test(selector));
}

export function omitStepScreenshot(step: GuideStep): GuideStep {
  return { ...step, frameMime: undefined, frameDataUri: undefined };
}

export function redactGuideStep(step: GuideStep): GuideStep {
  const blurBoxes: BlurBox[] = [...step.blurBoxes];
  let redactedCount = step.redactedCount;
  let title = step.title;
  let detail = step.detail;
  let selector = step.selector;
  let url = step.url;

  if (selector) {
    const selRes = redactText(selector);
    selector = selRes.text;
    redactedCount += selRes.count;
  }
  if (url) {
    const urlRes = redactText(url);
    url = urlRes.text;
    redactedCount += urlRes.count;
  }

  const sensitiveField = isSensitiveSelector(selector);
  if (sensitiveField && (step.action === "fill" || step.action === "type")) {
    title = `Enter sensitive value into ${selector ?? "protected field"}`;
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
    ...omitStepScreenshot(step),
    title,
    detail,
    selector,
    url,
    blurBoxes,
    redactedCount,
  };
}

export function redactGuide(guide: Guide): Guide {
  const titleRes = redactText(guide.title);
  const srcRes = redactText(guide.sourceFile);
  const steps = guide.steps.map((s) => redactGuideStep(s));
  const redactedTotal = titleRes.count + srcRes.count + steps.reduce((sum, s) => sum + s.redactedCount, 0);
  return {
    ...guide,
    title: titleRes.text,
    sourceFile: srcRes.text,
    steps,
    redactedTotal,
    screenshotsOmitted: true,
  };
}
