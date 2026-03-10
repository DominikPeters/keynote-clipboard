import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeTopLevelEntries, parseKeynoteClipboard, parseKeynoteClipboardFile } from "../src/parser.js";

const fixturePath = resolve(process.cwd(), "complex-keynote-clipboard.json");

describe("normalizeTopLevelEntries", () => {
  it("sorts numeric-key object tables by source index", () => {
    const entries = normalizeTopLevelEntries({
      "2": { type_identifier: "com.apple.apps.content-language.shape" },
      "0": { type_identifier: "com.apple.apps.content-language.image" },
      "1": { type_identifier: "com.apple.apps.content-language.connection-line" }
    });

    expect(entries.map((entry) => entry.sourceIndex)).toEqual([0, 1, 2]);
  });
});

describe("parseKeynoteClipboard", () => {
  it("parses shapes with and without path/fill/stroke objects", () => {
    const input = {
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        version: "1.0",
        stroke: "empty",
        fill: {
          color: {
            rgba: {
              color_space: "srgb",
              red: 1,
              green: 0,
              blue: 0,
              alpha: 1
            }
          }
        },
        path: {
          bezier: {
            path: "M 0 0 L 10 10"
          }
        },
        text: {
          attributed_string: ["hello", { NSUnderline: 0 }]
        }
      },
      "1": {
        type_identifier: "com.apple.apps.content-language.shape",
        version: "1.0",
        stroke: {
          line: {
            width: 2,
            pattern: "solid"
          }
        }
      }
    };

    const result = parseKeynoteClipboard(input);

    expect(result.document.shapes).toHaveLength(2);
    expect(result.document.shapes[0].path?.bezierPath).toBe("M 0 0 L 10 10");
    expect(result.document.shapes[0].fill?.color?.rgba?.red).toBe(1);
    expect(result.document.shapes[0].stroke.kind).toBe("empty");
    expect(result.document.shapes[1].stroke.kind).toBe("line");
  });

  it("resolves connection line anchors to shape identifiers", () => {
    const input = {
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        identifier: "shape-a",
        stroke: "empty"
      },
      "1": {
        type_identifier: "com.apple.apps.content-language.shape",
        identifier: "shape-b",
        stroke: "empty"
      },
      "2": {
        type_identifier: "com.apple.apps.content-language.connection-line",
        stroke: {
          line: {
            width: 1,
            pattern: "solid"
          }
        },
        head: {
          anchor: {
            object_id: "shape-a"
          }
        },
        tail: {
          anchor: {
            object_id: "shape-b"
          }
        }
      }
    };

    const result = parseKeynoteClipboard(input);

    expect(result.document.connectionLines).toHaveLength(1);
    expect(result.document.connectionLines[0].resolvedHeadShapeId).toBe("shape-a");
    expect(result.document.connectionLines[0].resolvedTailShapeId).toBe("shape-b");
  });

  it("parses image resources", () => {
    const input = {
      "0": {
        type_identifier: "com.apple.apps.content-language.image",
        version: "1.0",
        stroke: "empty",
        geometry: {
          position: {
            x: 1,
            y: 2
          },
          size: {
            width: 3,
            height: 4
          }
        },
        resource: {
          indirect: {
            identifier: "res-id",
            filename: "equation.pdf"
          }
        }
      }
    };

    const result = parseKeynoteClipboard(input);

    expect(result.document.images).toHaveLength(1);
    expect(result.document.images[0].resource?.indirect?.identifier).toBe("res-id");
    expect(result.document.images[0].resource?.indirect?.filename).toBe("equation.pdf");
  });

  it("parses the fixture and returns expected counts", async () => {
    const result = await parseKeynoteClipboardFile(fixturePath);

    expect(result.stats.totalObjects).toBe(44);
    expect(result.document.shapes).toHaveLength(40);
    expect(result.document.connectionLines).toHaveLength(3);
    expect(result.document.images).toHaveLength(1);
    expect(result.document.unknownObjects).toHaveLength(0);
  });

  it("accepts JSON string input", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const result = parseKeynoteClipboard(raw);

    expect(result.stats.totalObjects).toBe(44);
  });
});
