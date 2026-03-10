export { decodeArchivedValue, isLikelyBplistBase64, sanitizeForJson } from "./archive.js";
export { normalizeTopLevelEntries, parseKeynoteClipboard, parseKeynoteClipboardFile } from "./parser.js";

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
  UnknownObject
} from "./types.js";
