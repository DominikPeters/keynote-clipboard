import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

describe("CLI", () => {
  it("prints inspect output and exits with 0", async () => {
    const outputs: string[] = [];
    const errors: string[] = [];

    const code = await runCli(["inspect", "complex-keynote-clipboard.json"], {
      writeStdout: (text) => outputs.push(text),
      writeStderr: (text) => errors.push(text)
    });

    expect(code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(() => JSON.parse(outputs.join(""))).not.toThrow();
  });

  it("returns non-zero for invalid file", async () => {
    const outputs: string[] = [];
    const errors: string[] = [];

    const code = await runCli(["inspect", "missing-file.json"], {
      writeStdout: (text) => outputs.push(text),
      writeStderr: (text) => errors.push(text)
    });

    expect(code).toBe(1);
    expect(outputs).toHaveLength(0);
    expect(errors.join("")).toContain("Error:");
  });
});
