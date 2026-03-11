import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeTopLevelEntries, parseKeynoteClipboard, parseKeynoteClipboardFile } from "../src/parser.js";

const fixturePath = resolve(process.cwd(), "complex-keynote-clipboard.json");
const rectangleFixturePath = resolve(process.cwd(), "rectangle-with-text.json");

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

  it("parses layout properties, gradients, shadows, bezier space, and normalized text style", () => {
    const input = {
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        fill: {
          gradient: {
            opacity: 0.8,
            flavor: {
              linear: {
                angle: 45
              }
            },
            stops: [
              {
                fraction: 0,
                inflection: 0.5,
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
              {
                fraction: 1,
                inflection: 0.5,
                color: {
                  rgba: {
                    color_space: "srgb",
                    red: 0,
                    green: 0,
                    blue: 1,
                    alpha: 1
                  }
                }
              }
            ]
          }
        },
        shadow: {
          dropShadow: {
            opacity: 0.5,
            angle: 90,
            radius: 5,
            offset: 2,
            color: {
              rgba: {
                color_space: "srgb",
                red: 0,
                green: 0,
                blue: 0,
                alpha: 1
              }
            }
          }
        },
        layout_properties: {
          vertical_alignment: "top",
          shrink_to_fit: false,
          padding: {
            top: 4,
            left: 6,
            right: 8,
            bottom: 10
          }
        },
        path: {
          bezier: {
            path: "M 0 0 L 100 0 L 100 100 Z",
            space: {
              position: { x: 0, y: 0 },
              size: { width: 100, height: 100 }
            }
          }
        },
        text: {
          attributed_string: [
            "Styled",
            {
              NSUnderline: 1,
              NSStrikethrough: 0,
              NSSuperScript: 2,
              NSBaselineOffset: 1.5,
              NSLigature: 1
            }
          ]
        }
      }
    };

    const result = parseKeynoteClipboard(input);
    const shape = result.document.shapes[0];

    expect(shape.layoutProperties?.verticalAlignment).toBe("top");
    expect(shape.layoutProperties?.padding?.left).toBe(6);
    expect(shape.fill?.gradient?.flavor?.kind).toBe("linear");
    expect(shape.fill?.gradient?.stops).toHaveLength(2);
    expect(shape.shadow?.dropShadow?.radius).toBe(5);
    expect(shape.path?.space?.size?.width).toBe(100);
    expect(shape.text?.style?.underline).toBe(true);
    expect(shape.text?.style?.strikethrough).toBe(false);
    expect(shape.text?.style?.superscript).toBe(2);
    expect(shape.text?.style?.baselineOffset).toBe(1.5);
    expect(shape.text?.style?.ligature).toBe(true);
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

    expect(result.document.shapes.some((shape) => Boolean(shape.layoutProperties))).toBe(true);
    expect(result.document.shapes.some((shape) => Boolean(shape.fill?.gradient))).toBe(true);
    expect(result.document.shapes.some((shape) => Boolean(shape.shadow?.dropShadow || shape.shadow?.contactShadow))).toBe(true);
    expect(result.document.shapes.some((shape) => Boolean(shape.path?.space))).toBe(true);

    const textShape = result.document.shapes.find((shape) => shape.text?.style?.fontFamily);
    expect(textShape?.text?.style?.fontFamily).toBe("HelveticaNeue-Medium");
    expect(textShape?.text?.style?.fontSize).toBeTypeOf("number");
    expect(textShape?.text?.style?.paragraphAlignment).toBe("center");
  });

  it("accepts JSON string input", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const result = parseKeynoteClipboard(raw);

    expect(result.stats.totalObjects).toBe(44);
  });

  it("extracts text color from archived NSColor data", async () => {
    const result = await parseKeynoteClipboardFile(rectangleFixturePath);
    const textShape = result.document.shapes.find((shape) => shape.text?.content?.includes("Rectangle with Text"));

    expect(textShape?.text?.style?.fontColor).toBe("rgb(255,255,255)");
  });
});
