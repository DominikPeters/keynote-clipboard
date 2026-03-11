import { describe, expect, it } from "vitest";

import {
  KEYNOTE_CLIPBOARD_FORMAT,
  applyClipboardChange,
  convertPayload,
  hasKeynoteFormat,
  type CustomClipboardPayload
} from "./clipboardLogic";

describe("hasKeynoteFormat", () => {
  it("detects target format presence", () => {
    expect(hasKeynoteFormat(["public.rtf", KEYNOTE_CLIPBOARD_FORMAT])).toBe(true);
    expect(hasKeynoteFormat(["public.rtf", "public.html"])).toBe(false);
  });
});

describe("convertPayload", () => {
  it("returns both svg and tikz outputs on valid payload", () => {
    const payload: CustomClipboardPayload = {
      format: KEYNOTE_CLIPBOARD_FORMAT,
      size: 8,
      utf8: "{}",
      base64: "e30="
    };

    const result = convertPayload(payload, {
      toSvg: () => ({
        svg: "<svg></svg>",
        diagnostics: [{ code: "svg", message: "ok", severity: "warning" }],
        stats: {
          renderedShapes: 1,
          renderedConnectionLines: 0,
          renderedTextNodes: 0,
          renderedImagePlaceholders: 0,
          skippedObjects: 0
        }
      }),
      toTikz: () => ({
        tikz: "\\documentclass[tikz]{standalone}",
        diagnostics: [{ code: "tikz", message: "ok", severity: "warning" }],
        stats: {
          renderedShapes: 1,
          renderedConnectionLines: 0,
          renderedTextNodes: 0,
          renderedImagePlaceholders: 0,
          skippedObjects: 0
        }
      })
    });

    expect(result.ok).toBe(true);
    expect(result.svg.ok).toBe(true);
    expect(result.tikz.ok).toBe(true);
    if (result.svg.ok) {
      expect(result.svg.output).toContain("<svg>");
      expect(result.svg.diagnostics).toHaveLength(1);
      expect(result.svg.stats.renderedShapes).toBe(1);
    }
    if (result.tikz.ok) {
      expect(result.tikz.output).toContain("\\documentclass");
      expect(result.tikz.diagnostics).toHaveLength(1);
      expect(result.tikz.stats.renderedShapes).toBe(1);
    }
  });

  it("keeps mode-specific failure details when one converter throws", () => {
    const payload: CustomClipboardPayload = {
      format: KEYNOTE_CLIPBOARD_FORMAT,
      size: 3,
      utf8: "{x",
      base64: "e3g="
    };

    const result = convertPayload(payload, {
      toSvg: () => {
        throw new Error("Invalid JSON input for SVG");
      },
      toTikz: () => ({
        tikz: "\\documentclass[tikz]{standalone}",
        diagnostics: [],
        stats: {
          renderedShapes: 0,
          renderedConnectionLines: 0,
          renderedTextNodes: 0,
          renderedImagePlaceholders: 0,
          skippedObjects: 1
        }
      })
    });

    expect(result.ok).toBe(false);
    expect(result.svg.ok).toBe(false);
    expect(result.tikz.ok).toBe(true);
    if (!result.svg.ok) {
      expect(result.svg.error).toContain("Invalid JSON input for SVG");
    }
  });

  it("returns mode-specific errors for missing UTF-8 payload", () => {
    const payload: CustomClipboardPayload = {
      format: KEYNOTE_CLIPBOARD_FORMAT,
      size: 0,
      utf8: null,
      base64: ""
    };

    const result = convertPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.svg.ok).toBe(false);
    expect(result.tikz.ok).toBe(false);
    if (!result.svg.ok) {
      expect(result.svg.error).toContain("UTF-8");
    }
    if (!result.tikz.ok) {
      expect(result.tikz.error).toContain("UTF-8");
    }
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
