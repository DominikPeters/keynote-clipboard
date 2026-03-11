export { decodeArchivedValue, isLikelyBplistBase64, sanitizeForJson } from "./archive.js";
export { normalizeTopLevelEntries, parseKeynoteClipboard, parseKeynoteClipboardFile } from "./parser.js";
export { toSvg, toSvgFromClipboard } from "./svg.js";

export type {
  ConnectionLineObject,
  DecodedArchiveResult,
  Diagnostic,
  Fill,
  Geometry,
  ImageObject,
  KeynoteClipboardDocument,
  ParseMode,
  ParseOptions,
  ParseResult,
  ParseStats,
  ParsedText,
  ShapeObject,
  Stroke,
  SvgOptions,
  SvgResult,
  SvgStats,
  UnknownObject
} from "./types.js";
