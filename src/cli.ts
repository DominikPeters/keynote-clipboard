#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { stderr, stdout } from "node:process";

import { parseKeynoteClipboardFile } from "./parser.js";
import { toSvg } from "./svg.js";

export interface CliIo {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
}

const defaultIo: CliIo = {
  writeStdout: (text) => stdout.write(text),
  writeStderr: (text) => stderr.write(text)
};

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, maybePath, ...flags] = argv;

  if (!maybePath || (command !== "inspect" && command !== "svg")) {
    io.writeStderr(usageText());
    return 1;
  }

  const pretty = flags.includes("--pretty");
  const includeDiagnostics = flags.includes("--diagnostics");
  const outPath = getFlagValue(flags, "--out");

  try {
    const result = await parseKeynoteClipboardFile(maybePath);

    if (command === "inspect") {
      const output = includeDiagnostics
        ? result
        : {
            document: result.document,
            stats: result.stats
          };

      const spacing = pretty ? 2 : 0;
      io.writeStdout(`${JSON.stringify(output, jsonReplacer, spacing)}\n`);
      return 0;
    }

    const svgResult = toSvg(result.document, { includeDiagnostics });
    if (outPath) {
      await writeFile(outPath, svgResult.svg, "utf8");
    } else {
      io.writeStdout(`${svgResult.svg}\n`);
    }

    if (includeDiagnostics) {
      const diagOutput = {
        diagnostics: [...result.diagnostics, ...svgResult.diagnostics],
        stats: svgResult.stats
      };
      const spacing = pretty ? 2 : 0;
      io.writeStderr(`${JSON.stringify(diagOutput, jsonReplacer, spacing)}\n`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeStderr(`Error: ${message}\n`);
    return 1;
  }
}

function usageText(): string {
  return [
    "Usage:",
    "  keynote-clipboard inspect <file> [--pretty] [--diagnostics]",
    "  keynote-clipboard svg <file> [--pretty] [--diagnostics] [--out <path>]",
    "",
    "Flags:",
    "  --pretty       Pretty-print JSON output",
    "  --diagnostics  Include diagnostics output",
    "  --out          Write SVG output to a file (svg command only)"
  ].join("\n");
}

function getFlagValue(flags: string[], name: string): string | undefined {
  const idx = flags.indexOf(name);
  if (idx === -1) {
    return undefined;
  }

  const next = flags[idx + 1];
  if (!next || next.startsWith("--")) {
    return undefined;
  }

  return next;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof ArrayBuffer) {
    return { type: "ArrayBuffer", byteLength: value.byteLength };
  }

  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
