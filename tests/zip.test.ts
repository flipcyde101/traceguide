import { describe, it, expect } from "vitest";
import { createZipBuffer, isSafeZipEntryName, readZipBuffer } from "../src/zip/archive.js";

describe("pure-TS zero-dep ZIP reader & writer", () => {
  it("round-trips compressed entries cleanly and rejects zip-slip paths", () => {
    const zip = createZipBuffer([
      { name: "test.trace", data: Buffer.from('{"type":"before"}\n', "utf8") },
      { name: "resources/frame1.svg", data: Buffer.from("<svg></svg>", "utf8") },
    ]);
    const entries = readZipBuffer(zip);
    expect(entries.get("test.trace")?.toString("utf8")).toBe('{"type":"before"}\n');
    expect(entries.get("resources/frame1.svg")?.toString("utf8")).toBe("<svg></svg>");

    expect(isSafeZipEntryName("../evil.txt")).toBe(false);
    expect(isSafeZipEntryName("/etc/passwd")).toBe(false);
    expect(isSafeZipEntryName("C:/Windows/win.ini")).toBe(false);
    expect(() => createZipBuffer([{ name: "../escape.txt", data: Buffer.from("x") }])).toThrow();
  });

  it("enforces maxEntryBytes decompression guard against zip bombs", () => {
    const big = Buffer.alloc(64 * 1024, 0x41);
    const zip = createZipBuffer([{ name: "big.txt", data: big }]);
    expect(() => readZipBuffer(zip, { maxEntryBytes: 1024 })).toThrow(/exceeds max entry size/i);
  });
});
