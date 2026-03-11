import { describe, expect, it } from "vitest";

import {
  KEYNOTE_CLIPBOARD_FORMAT,
  applyClipboardChange,
  convertPayloadToSvg,
  hasKeynoteFormat,
  type CustomClipboardPayload
} from "./clipboardLogic";

describe("hasKeynoteFormat", () => {
  it("detects target format presence", () => {
    expect(hasKeynoteFormat(["public.rtf", KEYNOTE_CLIPBOARD_FORMAT])).toBe(true);
    expect(hasKeynoteFormat(["public.rtf", "public.html"])).toBe(false);
  });
});

describe("convertPayloadToSvg", () => {
  it("returns svg and diagnostics on valid payload", () => {
    const payload: CustomClipboardPayload = {
      format: KEYNOTE_CLIPBOARD_FORMAT,
      size: 8,
      utf8: "{}",
      base64: "e30="
    };

    const result = convertPayloadToSvg(payload, () => ({
      svg: "<svg></svg>",
      diagnostics: [{ code: "x", message: "ok", severity: "warning" }],
      stats: {
        renderedShapes: 1,
        renderedConnectionLines: 0,
        renderedTextNodes: 0,
        renderedImagePlaceholders: 0,
        skippedObjects: 0
      }
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.svg).toContain("<svg>");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.stats.renderedShapes).toBe(1);
    }
  });

  it("returns error when conversion throws (invalid JSON flow)", () => {
    const payload: CustomClipboardPayload = {
      format: KEYNOTE_CLIPBOARD_FORMAT,
      size: 3,
      utf8: "{x",
      base64: "e3g="
    };

    const result = convertPayloadToSvg(payload, () => {
      throw new Error("Invalid JSON input");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid JSON");
    }
  });

  it("returns error for missing UTF-8 payload", () => {
    const payload: CustomClipboardPayload = {
      format: KEYNOTE_CLIPBOARD_FORMAT,
      size: 0,
      utf8: null,
      base64: ""
    };

    const result = convertPayloadToSvg(payload);
    expect(result.ok).toBe(false);
  });
});

describe("applyClipboardChange", () => {
  it("increments count and updates timestamp", () => {
    const at = new Date("2026-03-11T12:00:00.000Z");
    const result = applyClipboardChange({ refreshCount: 4, lastUpdatedIso: "" }, at);

    expect(result.refreshCount).toBe(5);
    expect(result.lastUpdatedIso).toBe("2026-03-11T12:00:00.000Z");
  });
});
