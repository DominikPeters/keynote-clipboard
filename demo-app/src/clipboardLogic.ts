import type { SvgResult, TikzResult } from "@keynote-clipboard";
import { toSvgFromClipboard, toTikzFromClipboard } from "@keynote-clipboard";

export const KEYNOTE_CLIPBOARD_FORMAT = "com.apple.apps.content-language.canvas-object-1.0";

export type ClipboardState = {
  refreshCount: number;
  lastUpdatedIso: string;
};

export type CustomClipboardPayload = {
  format: string;
  size: number;
  utf8?: string | null;
  base64: string;
};

export type SvgConversionResult =
  | {
      ok: true;
      output: string;
      diagnostics: unknown[];
      stats: SvgResult["stats"];
    }
  | {
      ok: false;
      output: string;
      error: string;
      diagnostics: unknown[];
      stats: SvgResult["stats"] | null;
    };

export type TikzConversionResult =
  | {
      ok: true;
      output: string;
      diagnostics: unknown[];
      stats: TikzResult["stats"];
    }
  | {
      ok: false;
      output: string;
      error: string;
      diagnostics: unknown[];
      stats: TikzResult["stats"] | null;
    };

export type DualConversionOutcome = {
  ok: boolean;
  svg: SvgConversionResult;
  tikz: TikzConversionResult;
};

export type ClipboardConverters = {
  toSvg: (input: string | unknown) => SvgResult;
  toTikz: (input: string | unknown) => TikzResult;
};

const DEFAULT_CONVERTERS: ClipboardConverters = {
  toSvg: (input) => toSvgFromClipboard(input, {}, { includeDiagnostics: true }),
  toTikz: (input) => toTikzFromClipboard(input, {}, { standalone: true, includeDiagnostics: true })
};

export function hasKeynoteFormat(formats: string[]): boolean {
  return formats.includes(KEYNOTE_CLIPBOARD_FORMAT);
}

export function applyClipboardChange(
  state: ClipboardState,
  now: Date = new Date()
): ClipboardState {
  return {
    refreshCount: state.refreshCount + 1,
    lastUpdatedIso: now.toISOString()
  };
}

function missingUtf8Outcome(): DualConversionOutcome {
  return {
    ok: false,
    svg: {
      ok: false,
      output: "",
      error: "Payload is not valid UTF-8 text",
      diagnostics: [],
      stats: null
    },
    tikz: {
      ok: false,
      output: "",
      error: "Payload is not valid UTF-8 text",
      diagnostics: [],
      stats: null
    }
  };
}

export function convertPayload(
  payload: CustomClipboardPayload,
  converters: ClipboardConverters = DEFAULT_CONVERTERS
): DualConversionOutcome {
  if (!payload.utf8) {
    return missingUtf8Outcome();
  }

  const input = payload.utf8;

  let svg: SvgConversionResult;
  try {
    const result = converters.toSvg(input);
    svg = {
      ok: true,
      output: result.svg,
      diagnostics: result.diagnostics,
      stats: result.stats
    };
  } catch (error) {
    svg = {
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      diagnostics: [],
      stats: null
    };
  }

  let tikz: TikzConversionResult;
  try {
    const result = converters.toTikz(input);
    tikz = {
      ok: true,
      output: result.tikz,
      diagnostics: result.diagnostics,
      stats: result.stats
    };
  } catch (error) {
    tikz = {
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      diagnostics: [],
      stats: null
    };
  }

  return {
    ok: svg.ok && tikz.ok,
    svg,
    tikz
  };
}
