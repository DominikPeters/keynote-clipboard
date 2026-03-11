import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { parseKeynoteClipboard, parseKeynoteClipboardFile } from "../src/parser.js";
import { toSvg, toSvgFromClipboard } from "../src/svg.js";

const fixturePath = resolve(process.cwd(), "complex-keynote-clipboard.json");
const topRightFixturePath = resolve(process.cwd(), "rectangle-top-right.json");
const leftFixturePath = resolve(process.cwd(), "rectangle-left.json");
const dashPatternsFixturePath = resolve(process.cwd(), "dash-patterns.json");
const arrowHeadsFixturePath = resolve(process.cwd(), "arrow-heads.json");
const circlePlacementFixturePath = resolve(process.cwd(), "circle-shape-placement.json");

describe("toSvg", () => {
  it("renders shape path with fill/stroke", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        version: "1.0",
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
        stroke: {
          line: {
            width: 2,
            pattern: "solid",
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
        geometry: {
          position: { x: 50, y: 50 },
          size: { width: 100, height: 100 }
        },
        path: {
          bezier: {
            path: "M 0 0 L 100 0 L 100 100 Z"
          }
        }
      }
    });

    const result = toSvg(parsed.document);
    expect(result.svg).toContain("<path");
    expect(result.svg).toContain('fill="rgb(255,0,0)"');
    expect(result.svg).toContain('stroke="rgb(0,0,0)"');
    expect(result.stats.renderedShapes).toBe(1);
  });

  it("renders linear gradient fills via defs", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 100, y: 100 },
          size: { width: 100, height: 100 }
        },
        fill: {
          gradient: {
            opacity: 0.8,
            flavor: {
              linear: {
                angle: 90
              }
            },
            stops: [
              {
                fraction: 0,
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
        }
      }
    });

    const result = toSvg(parsed.document);
    expect(result.svg).toContain("<defs>");
    expect(result.svg).toContain("<linearGradient");
    expect(result.svg).toContain('fill="url(#kc-grad-0)"');
  });

  it("renders shadow filters and applies them to shapes", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 100, y: 100 },
          size: { width: 100, height: 100 }
        },
        shadow: {
          dropShadow: {
            opacity: 0.5,
            angle: 90,
            radius: 6,
            offset: 4,
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
        }
      }
    });

    const result = toSvg(parsed.document);
    expect(result.svg).toContain("<filter");
    expect(result.svg).toContain("feDropShadow");
    expect(result.svg).toContain('filter="url(#kc-filter-0)"');
  });

  it("uses bezier space when placing paths", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 50, y: 50 },
          size: { width: 200, height: 100 }
        },
        path: {
          bezier: {
            path: "M 0 0 L 100 0 L 100 100 Z",
            space: {
              position: { x: 0, y: 0 },
              size: { width: 100, height: 100 }
            }
          }
        }
      }
    });

    const result = toSvg(parsed.document);
    expect(result.svg).toContain('transform="matrix(2 0 0 1 -50 0)"');
  });

  it("falls back to rect when shape path is missing", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 100, y: 100 },
          size: { width: 80, height: 40 }
        }
      }
    });

    const result = toSvg(parsed.document);
    expect(result.svg).toContain("<rect");
    expect(result.diagnostics.some((d) => d.code === "svg-shape-rect-fallback")).toBe(true);
  });

  it("renders connection lines deterministically with corner hints", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.connection-line",
        stroke: {
          line: {
            width: 2,
            pattern: "solid",
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
        head: {
          end_point: { x: 10, y: 10 }
        },
        tail: {
          end_point: { x: 80, y: 80 }
        },
        line_type: {
          corner: { x: 10, y: 80 }
        }
      }
    });

    const result = toSvg(parsed.document);
    expect(result.svg).toContain('d="M 10 10 L 10 80 L 80 80"');
    expect(result.stats.renderedConnectionLines).toBe(1);
  });

  it("renders basic text and image placeholders", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 100, y: 100 },
          size: { width: 120, height: 60 }
        },
        text: {
          attributed_string: ["Hello SVG", {}]
        }
      },
      "1": {
        type_identifier: "com.apple.apps.content-language.image",
        stroke: "empty",
        geometry: {
          position: { x: 220, y: 100 },
          size: { width: 80, height: 80 }
        },
        resource: {
          indirect: {
            filename: "equation.pdf"
          }
        }
      }
    });

    const result = toSvg(parsed.document);
    expect(result.svg).toContain("Hello SVG");
    expect(result.svg).toContain("equation.pdf");
    expect(result.stats.renderedTextNodes).toBe(1);
    expect(result.stats.renderedImagePlaceholders).toBe(1);
  });

  it("renders text using normalized style and layout alignment", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 100, y: 100 },
          size: { width: 120, height: 60 }
        },
        layout_properties: {
          vertical_alignment: "top",
          padding: {
            top: 6,
            left: 10,
            right: 8,
            bottom: 4
          }
        },
        text: {
          attributed_string: ["Hello SVG", {}]
        }
      }
    });

    const text = parsed.document.shapes[0].text;
    if (text) {
      text.style = {
        fontFamily: "Fira Sans",
        fontSize: 20,
        fontColor: "rgb(1,2,3)",
        paragraphAlignment: "start"
      };
    }

    const result = toSvg(parsed.document);
    expect(result.svg).toContain('font-family="Fira Sans"');
    expect(result.svg).toContain('font-size="20"');
    expect(result.svg).toContain('fill="rgb(1,2,3)"');
    expect(result.svg).toContain('text-anchor="start"');
    expect(result.svg).toContain('x="50"');
    expect(result.svg).toContain('y="76"');
  });

  it("keeps top-right text inside the rectangle and renders decorations", async () => {
    const parsed = await parseKeynoteClipboardFile(topRightFixturePath);
    const result = toSvg(parsed.document, { includeDiagnostics: true });

    const textTag = result.svg.match(/<text[^>]*>/)?.[0] ?? "";
    expect(textTag).toContain('text-anchor="end"');
    expect(textTag).toContain('dominant-baseline="text-before-edge"');
    expect(textTag).toContain('text-decoration="underline line-through"');
    expect(textTag).toContain('clip-path="url(#kc-clip-');
  });

  it("renders default paragraph alignment as left/start for rectangle-left fixture", async () => {
    const parsed = await parseKeynoteClipboardFile(leftFixturePath);
    const result = toSvg(parsed.document, { includeDiagnostics: true });
    const textTag = result.svg.match(/<text[^>]*>/)?.[0] ?? "";

    expect(textTag).toContain('text-anchor="start"');
  });

  it("renders dash patterns from fixture strokes", async () => {
    const parsed = await parseKeynoteClipboardFile(dashPatternsFixturePath);
    const result = toSvg(parsed.document, { includeDiagnostics: true });

    expect(result.svg).toContain('stroke-dasharray="');
    expect(result.svg).toContain('stroke-linecap="round"');
  });

  it("renders arrowhead markers for shape head/tail styles", async () => {
    const parsed = await parseKeynoteClipboardFile(arrowHeadsFixturePath);
    const result = toSvg(parsed.document, { includeDiagnostics: true });

    expect(result.svg).toContain("<marker");
    expect(result.svg).toContain('marker-start="url(#kc-marker-');
    expect(result.svg).toContain('marker-end="url(#kc-marker-');
  });

  it("applies geometry transforms to circle/ellipse paths", async () => {
    const parsed = await parseKeynoteClipboardFile(circlePlacementFixturePath);
    const result = toSvg(parsed.document, { includeDiagnostics: true });
    const transformedPaths = result.svg.match(/<path[^>]*transform="matrix\([^"]+\)"/g) ?? [];

    expect(transformedPaths.length).toBe(4);
  });

  it("computes auto-bounds viewBox", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 300, y: 200 },
          size: { width: 40, height: 20 }
        }
      }
    });

    const result = toSvg(parsed.document);
    expect(result.svg).toContain("viewBox=");
    expect(result.svg).not.toContain('viewBox="0 0 100 100"');
  });

  it("parses and converts fixture with non-zero rendered stats", async () => {
    const parsed = await parseKeynoteClipboardFile(fixturePath);
    const result = toSvg(parsed.document, { includeDiagnostics: true });

    expect(result.svg).toContain("<svg");
    expect(result.stats.renderedShapes).toBeGreaterThan(0);
    expect(result.stats.renderedConnectionLines).toBe(3);
    expect(result.stats.renderedImagePlaceholders).toBe(1);
  });

  it("toSvgFromClipboard includes parse and svg diagnostics", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const result = toSvgFromClipboard(raw, {}, { includeDiagnostics: true });
    expect(result.svg).toContain("<svg");
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});

describe("svg CLI", () => {
  it("outputs SVG to stdout", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runCli(["svg", "complex-keynote-clipboard.json"], {
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text)
    });

    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("<svg");
    expect(stderr).toHaveLength(0);
  });

  it("writes SVG to file with --out", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "keynote-clipboard-svg-"));
    const outputPath = join(tmp, "out.svg");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runCli(["svg", "complex-keynote-clipboard.json", "--out", outputPath], {
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text)
    });

    const written = await readFile(outputPath, "utf8");

    expect(code).toBe(0);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("");
    expect(written).toContain("<svg");
  });
});
