import { describe, it, expect } from "vitest";
import { isSensitiveSelector, redactText } from "../src/redact/pii.js";

describe("PII & secret auto-redactor", () => {
  it("redacts emails, Bearer tokens, OpenAI keys, GitHub tokens, and detects sensitive selectors", () => {
    const sample = "Email jane.doe@example.com with Bearer abc.def.ghi and key sk-proj-1234567890abcdef and ghp_1234567890abcdef123456";
    const res = redactText(sample);
    expect(res.count).toBe(4);
    expect(res.text).not.toContain("jane.doe@example.com");
    expect(res.text).not.toContain("sk-proj-");
    expect(res.text).not.toContain("ghp_1234");
    expect(res.text).toContain("[REDACTED_EMAIL]");
    expect(res.text).toContain("[REDACTED_API_KEY]");
    expect(res.text).toContain("[REDACTED_GH_TOKEN]");

    expect(isSensitiveSelector('input[type="password"]')).toBe(true);
    expect(isSensitiveSelector("#api_key_input")).toBe(true);
    expect(isSensitiveSelector("#search-box")).toBe(false);
  });
});
