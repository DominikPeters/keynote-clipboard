#!/usr/bin/env node

import { stderr, stdout } from "node:process";

import { parseKeynoteClipboardFile } from "./parser.js";

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

  if (command !== "inspect" || !maybePath) {
    io.writeStderr(usageText());
    return 1;
  }

  const pretty = flags.includes("--pretty");
  const includeDiagnostics = flags.includes("--diagnostics");

  try {
    const result = await parseKeynoteClipboardFile(maybePath);
    const output = includeDiagnostics
      ? result
      : {
          document: result.document,
          stats: result.stats
        };

    const spacing = pretty ? 2 : 0;
    io.writeStdout(`${JSON.stringify(output, jsonReplacer, spacing)}\n`);
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
    "",
    "Flags:",
    "  --pretty       Pretty-print JSON output",
    "  --diagnostics  Include parser diagnostics in output"
  ].join("\n");
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
