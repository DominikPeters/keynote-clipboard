import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { parseKeynoteClipboard, parseKeynoteClipboardFile } from "../src/parser.js";
import { toTikz, toTikzFromClipboard } from "../src/tikz.js";

const fixturePath = resolve(process.cwd(), "complex-keynote-clipboard.json");
const arrowHeadsFixturePath = resolve(process.cwd(), "arrow-heads.json");
const dashPatternsFixturePath = resolve(process.cwd(), "dash-patterns.json");

describe("toTikz", () => {
  it("renders shape paths", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
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

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("\\begin{tikzpicture}");
    expect(result.tikz).toContain("\\path[");
    expect(result.stats.renderedShapes).toBe(1);
  });

  it("renders dash patterns and markers", async () => {
    const dashed = await parseKeynoteClipboardFile(dashPatternsFixturePath);
    const dashedTikz = toTikz(dashed.document, { includeDiagnostics: true });
    expect(dashedTikz.tikz).toContain("dash pattern=on");

    const arrows = await parseKeynoteClipboardFile(arrowHeadsFixturePath);
    const arrowsTikz = toTikz(arrows.document, { includeDiagnostics: true });
    expect(arrowsTikz.tikz).toContain("arrows=");
  });

  it("renders gradient shadings and shadows", () => {
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

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("\\pgfdeclarehorizontalshading");
    expect(result.tikz).toContain("shading=kcshade0");
    expect(result.tikz).toContain("drop shadow=");
  });

  it("uses pt-to-cm conversion ratio with 2-decimal rounding", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.connection-line",
        stroke: {
          line: {
            width: 72.27,
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
          end_point: { x: 8, y: 8 }
        },
        tail: {
          end_point: { x: 80.27, y: 8 }
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("line width=2.54cm");
    expect(result.tikz).toContain("(1.55,1.55)");
  });

  it("supports standalone wrapping", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 0, y: 0 },
          size: { width: 10, height: 10 }
        }
      }
    });

    const result = toTikz(parsed.document, { standalone: true });
    expect(result.tikz).toContain("\\documentclass[tikz]{standalone}");
    expect(result.tikz).toContain("\\begin{document}");
    expect(result.tikz).toContain("\\end{document}");
  });

  it("toTikzFromClipboard includes parse and tikz diagnostics", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const result = toTikzFromClipboard(raw, {}, { includeDiagnostics: true });
    expect(result.tikz).toContain("\\begin{tikzpicture}");
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});

describe("tikz CLI", () => {
  it("outputs TikZ to stdout", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runCli(["tikz", "complex-keynote-clipboard.json"], {
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text)
    });

    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("\\begin{tikzpicture}");
    expect(stderr).toHaveLength(0);
  });

  it("writes standalone TikZ to file with --out", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "keynote-clipboard-tikz-"));
    const outputPath = join(tmp, "out.tex");
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runCli([
      "tikz",
      "complex-keynote-clipboard.json",
      "--standalone",
      "--out",
      outputPath
    ], {
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text)
    });

    const written = await readFile(outputPath, "utf8");

    expect(code).toBe(0);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("");
    expect(written).toContain("\\documentclass[tikz]{standalone}");
  });
});
