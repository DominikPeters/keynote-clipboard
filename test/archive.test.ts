import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeArchivedValue } from "../src/archive.js";

const fixturePath = resolve(process.cwd(), "complex-keynote-clipboard.json");

describe("decodeArchivedValue", () => {
  it("decodes a real NS archived base64 payload", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const fixture = JSON.parse(raw) as Record<string, any>;

    const fontArchive = fixture["0"].text.attributed_string[1].NSFont;
    const decoded = decodeArchivedValue(fontArchive);

    expect(decoded.success).toBe(true);
    expect(decoded.decoded).not.toBeNull();
  });

  it("returns failure details for invalid archive input", () => {
    const decoded = decodeArchivedValue("not-a-bplist");

    expect(decoded.success).toBe(false);
    expect(decoded.error).toBeDefined();
  });

  it("decodes in runtimes without Buffer", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const fixture = JSON.parse(raw) as Record<string, any>;
    const fontArchive = fixture["0"].text.attributed_string[1].NSFont;

    const originalBuffer = (globalThis as { Buffer?: unknown }).Buffer;
    try {
      (globalThis as { Buffer?: unknown }).Buffer = undefined;
      const decoded = decodeArchivedValue(fontArchive);
      expect(decoded.success).toBe(true);
      expect(decoded.decoded).not.toBeNull();
    } finally {
      (globalThis as { Buffer?: unknown }).Buffer = originalBuffer;
    }
  });
});
