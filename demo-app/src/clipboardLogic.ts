import type { SvgResult } from "@keynote-clipboard";
import { toSvgFromClipboard } from "@keynote-clipboard";

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

export type ConversionOutcome =
  | {
      ok: true;
      svg: string;
      diagnostics: unknown[];
      stats: SvgResult["stats"];
    }
  | {
      ok: false;
      error: string;
      diagnostics: unknown[];
      stats: SvgResult["stats"] | null;
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

export function convertPayloadToSvg(
  payload: CustomClipboardPayload,
  converter: (input: string | unknown) => SvgResult = (input) =>
    toSvgFromClipboard(input, {}, { includeDiagnostics: true })
): ConversionOutcome {
  if (!payload.utf8) {
    return {
      ok: false,
      error: "Payload is not valid UTF-8 text",
      diagnostics: [],
      stats: null
    };
  }

  try {
    const result = converter(payload.utf8);
    return {
      ok: true,
      svg: result.svg,
      diagnostics: result.diagnostics,
      stats: result.stats
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostics: [],
      stats: null
    };
  }
}
