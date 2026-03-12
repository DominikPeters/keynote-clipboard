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
    expect(result.tikz).toContain("\\draw[black");
    expect(result.tikz).toContain("fill=red");
    expect(result.tikz).not.toContain("fill opacity=1");
    expect(result.tikz).not.toContain("draw opacity=1");
    expect(result.tikz).not.toContain("draw=none");
    expect(result.tikz).not.toContain("{rgb,255:");
    expect(result.stats.renderedShapes).toBe(1);
  });

  it("uses \\fill for fill-only shapes", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        fill: {
          color: {
            rgba: {
              red: 1,
              green: 0,
              blue: 0,
              alpha: 1
            }
          }
        },
        stroke: "empty",
        geometry: {
          position: { x: 10, y: 10 },
          size: { width: 20, height: 20 }
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("\\fill[red]");
    expect(result.tikz).not.toContain("draw=none");
  });

  it("uses \\draw for stroke-only shapes", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: {
          line: {
            width: 2,
            pattern: "solid",
            color: {
              rgba: {
                red: 0,
                green: 0,
                blue: 1,
                alpha: 1
              }
            }
          }
        },
        geometry: {
          position: { x: 10, y: 10 },
          size: { width: 20, height: 20 }
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("\\draw[blue");
    expect(result.tikz).not.toContain("draw=blue");
    expect(result.tikz).not.toContain("fill=none");
    expect(result.tikz).not.toContain("draw opacity=1");
  });

  it("renders dash patterns and markers", async () => {
    const dashed = await parseKeynoteClipboardFile(dashPatternsFixturePath);
    const dashedTikz = toTikz(dashed.document, { includeDiagnostics: true });
    expect(dashedTikz.tikz).toContain("dash pattern=on");

    const arrows = await parseKeynoteClipboardFile(arrowHeadsFixturePath);
    const arrowsTikz = toTikz(arrows.document, { includeDiagnostics: true });
    expect(arrowsTikz.tikz).toContain("arrows=");
  });

  it("prefers built-in axis shading and renders shadows", () => {
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
    expect(result.tikz).toContain("shading=axis");
    expect(result.tikz).toContain("bottom color=red");
    expect(result.tikz).toContain("top color=blue");
    expect(result.tikz).toContain("drop shadow=");
    expect(result.tikz).toContain("shadow xshift=0pt");
    expect(result.tikz).toContain("shadow yshift=4.01pt");
  });

  it("maps 180deg gradients to right-to-left for axis shading", () => {
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
            flavor: {
              linear: {
                angle: 180
              }
            },
            stops: [
              { fraction: 0, color: { rgba: { red: 1, green: 0, blue: 0, alpha: 1 } } },
              { fraction: 1, color: { rgba: { red: 0, green: 0, blue: 1, alpha: 1 } } }
            ]
          }
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("shading=axis");
    expect(result.tikz).toContain("left color=blue");
    expect(result.tikz).toContain("right color=red");
    expect(result.tikz).not.toContain("shading angle=");
  });

  it("falls back to declared shadings for complex multi-stop gradients", () => {
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
            flavor: {
              linear: {
                angle: 45
              }
            },
            stops: [
              { fraction: 0, color: { rgba: { red: 1, green: 0, blue: 0, alpha: 1 } } },
              { fraction: 0.25, color: { rgba: { red: 1, green: 1, blue: 0, alpha: 1 } } },
              { fraction: 1, color: { rgba: { red: 0, green: 0, blue: 1, alpha: 1 } } }
            ]
          }
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("\\pgfdeclarehorizontalshading");
    expect(result.tikz).toContain("shading=kcshade0");
  });

  it("uses keynote-point to TeX-point conversion for line width", () => {
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
    expect(result.tikz).toContain("line width=72.54pt");
    expect(result.tikz).toContain("(1.55,1.55)");
    expect(result.tikz).not.toContain("draw opacity=1");
  });

  it("emits dash pattern lengths in TeX pt", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.connection-line",
        stroke: {
          line: {
            width: 10,
            pattern: "short_dash",
            color: {
              rgba: {
                red: 0,
                green: 0,
                blue: 0,
                alpha: 1
              }
            }
          }
        },
        head: {
          end_point: { x: 0, y: 0 }
        },
        tail: {
          end_point: { x: 100, y: 0 }
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("dash pattern=on 20.07pt off 20.07pt");
    expect(result.tikz).not.toContain("dash pattern=on 20.07cm");
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

  it("uses xcolor parsing for CSS-like text and background colors", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 10, y: 10 },
          size: { width: 120, height: 60 }
        },
        text: {
          attributed_string: ["Colorized", {}]
        }
      }
    });

    const text = parsed.document.shapes[0].text;
    if (text) {
      text.style = {
        ...text.style,
        fontColor: "rgb(255, 0, 0)"
      };
    }

    const result = toTikz(parsed.document, { background: "#0000ff" });
    expect(result.tikz).toContain("fill=blue");
    expect(result.tikz).toContain("text=red");
    expect(result.tikz).not.toContain("anchor=center");
  });

  it("keeps opacity separate from xcolor output", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        fill: {
          color: {
            rgba: {
              red: 1,
              green: 0,
              blue: 0,
              alpha: 0.25
            }
          }
        },
        stroke: {
          line: {
            width: 2,
            pattern: "solid",
            color: {
              rgba: {
                red: 0,
                green: 0,
                blue: 1,
                alpha: 0.4
              }
            }
          }
        },
        geometry: {
          position: { x: 10, y: 10 },
          size: { width: 20, height: 20 }
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("fill=red");
    expect(result.tikz).toContain("\\draw[blue");
    expect(result.tikz).toContain("fill opacity=0.25");
    expect(result.tikz).toContain("draw opacity=0.4");
  });

  it("renders italic text styling in tikz nodes", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 100, y: 100 },
          size: { width: 120, height: 60 }
        },
        text: {
          attributed_string: ["Hello TikZ", {}]
        }
      }
    });

    const text = parsed.document.shapes[0].text;
    if (text) {
      text.style = {
        fontFamily: "HelveticaNeue-Italic",
        fontSize: 20
      };
    }

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("\\itshape");
  });

  it("sanitizes zero-width and bidi unicode controls in text", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 100, y: 100 },
          size: { width: 120, height: 60 }
        },
        text: {
          attributed_string: ["Hello\u200B \u2066TikZ\u2069", {}]
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).toContain("Hello TikZ");
    expect(result.tikz).not.toContain("\u200B");
    expect(result.tikz).not.toContain("\u2066");
    expect(result.tikz).not.toContain("\u2069");
  });

  it("skips text nodes when sanitized text is empty", () => {
    const parsed = parseKeynoteClipboard({
      "0": {
        type_identifier: "com.apple.apps.content-language.shape",
        stroke: "empty",
        geometry: {
          position: { x: 100, y: 100 },
          size: { width: 120, height: 60 }
        },
        text: {
          attributed_string: ["\u200B", {}]
        }
      }
    });

    const result = toTikz(parsed.document);
    expect(result.tikz).not.toContain("\\node[");
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
