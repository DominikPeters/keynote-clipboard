import { decodeArchivedValue, isLikelyBplistBase64 } from "./archive.js";
import type {
  Color,
  ConnectionLineEnd,
  ConnectionLineObject,
  Diagnostic,
  Fill,
  FillGradientFlavor,
  Geometry,
  ImageObject,
  ImageResource,
  KeynoteClipboardDocument,
  LineType,
  NormalizedTopLevelEntry,
  ParseOptions,
  ParseResult,
  ParsedPath,
  ParsedText,
  Position,
  ShapeLayoutProperties,
  ShapeObject,
  ShapeShadow,
  Size,
  Stroke,
  StrokeLine,
  TextStyle,
  UnknownObject
} from "./types.js";

const SHAPE_TYPE = "com.apple.apps.content-language.shape";
const CONNECTION_LINE_TYPE = "com.apple.apps.content-language.connection-line";
const IMAGE_TYPE = "com.apple.apps.content-language.image";

const DEFAULT_OPTIONS: Required<ParseOptions> = {
  mode: "lenient",
  decodeArchives: true,
  collectDiagnostics: true
};

export function parseKeynoteClipboard(input: string | unknown, options: ParseOptions = {}): ParseResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const diagnostics: Diagnostic[] = [];

  const addDiagnostic = (diagnostic: Diagnostic): void => {
    if (opts.collectDiagnostics) {
      diagnostics.push(diagnostic);
    }
  };

  const rawInput = typeof input === "string" ? parseInputJson(input) : input;
  const entries = normalizeTopLevelEntries(rawInput, addDiagnostic);

  const shapes: ShapeObject[] = [];
  const connectionLines: ConnectionLineObject[] = [];
  const images: ImageObject[] = [];
  const unknownObjects: UnknownObject[] = [];

  for (const entry of entries) {
    const typeIdentifier = getString(entry.raw.type_identifier);

    if (!typeIdentifier) {
      addDiagnostic({
        code: "missing-type-identifier",
        severity: "warning",
        message: "Object does not have a string type_identifier",
        sourceIndex: entry.sourceIndex
      });

      unknownObjects.push({
        kind: "unknown",
        sourceIndex: entry.sourceIndex,
        rawTypeIdentifier: "unknown",
        raw: entry.raw,
        version: getString(entry.raw.version)
      });
      continue;
    }

    if (typeIdentifier === SHAPE_TYPE) {
      shapes.push(parseShape(entry, opts, addDiagnostic));
      continue;
    }

    if (typeIdentifier === CONNECTION_LINE_TYPE) {
      connectionLines.push(parseConnectionLine(entry));
      continue;
    }

    if (typeIdentifier === IMAGE_TYPE) {
      images.push(parseImage(entry));
      continue;
    }

    addDiagnostic({
      code: "unknown-type-identifier",
      severity: "warning",
      message: `Unknown type_identifier: ${typeIdentifier}`,
      sourceIndex: entry.sourceIndex
    });

    unknownObjects.push({
      kind: "unknown",
      sourceIndex: entry.sourceIndex,
      rawTypeIdentifier: typeIdentifier,
      raw: entry.raw,
      version: getString(entry.raw.version)
    });
  }

  resolveConnectionLineAnchors(shapes, connectionLines, addDiagnostic);

  const document: KeynoteClipboardDocument = {
    sourceType: "canvas-object-1.0",
    shapes,
    connectionLines,
    images,
    unknownObjects
  };

  const stats = {
    totalObjects: entries.length,
    shapeCount: shapes.length,
    connectionLineCount: connectionLines.length,
    imageCount: images.length,
    unknownCount: unknownObjects.length,
    diagnosticCount: diagnostics.length
  };

  return { document, diagnostics, stats };
}

export async function parseKeynoteClipboardFile(
  filePath: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(filePath, "utf8");
  return parseKeynoteClipboard(content, options);
}

export function normalizeTopLevelEntries(
  input: unknown,
  addDiagnostic?: (diagnostic: Diagnostic) => void
): NormalizedTopLevelEntry[] {
  if (Array.isArray(input)) {
    return input
      .map((raw, sourceIndex) => ({ sourceIndex, raw }))
      .filter((entry): entry is NormalizedTopLevelEntry => isObject(entry.raw));
  }

  if (!isObject(input)) {
    throw new Error("Top-level clipboard payload must be an object or array");
  }

  const entries = Object.entries(input);
  const numericEntries = entries.filter(
    (entry): entry is [string, Record<string, unknown>] =>
      /^\d+$/.test(entry[0]) && isObject(entry[1])
  );

  if (numericEntries.length > 0) {
    return numericEntries
      .map(([key, raw]) => ({ sourceIndex: Number(key), raw }))
      .sort((a, b) => a.sourceIndex - b.sourceIndex);
  }

  if ("type_identifier" in input) {
    return [{ sourceIndex: 0, raw: input }];
  }

  addDiagnostic?.({
    code: "top-level-unknown-structure",
    severity: "warning",
    message: "Input is an object but not a recognized top-level structure"
  });

  return entries
    .map(([_, value], idx) => ({ sourceIndex: idx, raw: value }))
    .filter((entry): entry is NormalizedTopLevelEntry => isObject(entry.raw));
}

function parseInputJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseShape(
  entry: NormalizedTopLevelEntry,
  options: Required<ParseOptions>,
  addDiagnostic: (diagnostic: Diagnostic) => void
): ShapeObject {
  const raw = entry.raw;

  return {
    kind: "shape",
    sourceIndex: entry.sourceIndex,
    rawTypeIdentifier: SHAPE_TYPE,
    version: getString(raw.version),
    identifier: getString(raw.identifier),
    aspectRatioLocked: getBoolean(raw.aspect_ratio_locked),
    head: raw.head,
    tail: raw.tail,
    fill: parseFill(raw.fill),
    stroke: parseStroke(raw.stroke),
    geometry: parseGeometry(raw.geometry),
    path: parsePath(raw.path),
    text: parseText(raw.text, options, entry.sourceIndex, addDiagnostic),
    layoutProperties: parseLayoutProperties(raw.layout_properties),
    shadow: parseShadow(raw.shadow)
  };
}

function parseConnectionLine(entry: NormalizedTopLevelEntry): ConnectionLineObject {
  const raw = entry.raw;

  return {
    kind: "connection-line",
    sourceIndex: entry.sourceIndex,
    rawTypeIdentifier: CONNECTION_LINE_TYPE,
    version: getString(raw.version),
    stroke: parseStroke(raw.stroke),
    lineType: parseLineType(raw.line_type),
    head: parseConnectionLineEnd(raw.head),
    tail: parseConnectionLineEnd(raw.tail)
  };
}

function parseImage(entry: NormalizedTopLevelEntry): ImageObject {
  const raw = entry.raw;

  return {
    kind: "image",
    sourceIndex: entry.sourceIndex,
    rawTypeIdentifier: IMAGE_TYPE,
    version: getString(raw.version),
    aspectRatioLocked: getBoolean(raw.aspect_ratio_locked),
    stroke: parseStroke(raw.stroke),
    geometry: parseGeometry(raw.geometry),
    resource: parseResource(raw.resource)
  };
}

function parseFill(raw: unknown): Fill | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const color = parseColor(raw.color);
  const gradient = parseGradient(raw.gradient);

  if (!color && !gradient) {
    return {};
  }

  return {
    color,
    gradient
  };
}

function parseColor(raw: unknown): Color | undefined {
  if (!isObject(raw) || !isObject(raw.rgba)) {
    return undefined;
  }

  const rgbaRaw = raw.rgba;
  return {
    rgba: {
      colorSpace: getString(rgbaRaw.color_space),
      red: getNumber(rgbaRaw.red),
      green: getNumber(rgbaRaw.green),
      blue: getNumber(rgbaRaw.blue),
      alpha: getNumber(rgbaRaw.alpha)
    }
  };
}

function parseGradient(raw: unknown): Fill["gradient"] | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const stops = Array.isArray(raw.stops)
    ? raw.stops
        .filter((stop): stop is Record<string, unknown> => isObject(stop))
        .map((stop) => ({
          fraction: getNumber(stop.fraction),
          inflection: getNumber(stop.inflection),
          color: parseColor(stop.color)
        }))
    : undefined;

  return {
    opacity: getNumber(raw.opacity),
    flavor: parseGradientFlavor(raw.flavor),
    stops
  };
}

function parseGradientFlavor(raw: unknown): FillGradientFlavor | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  if (isObject(raw.linear)) {
    return {
      kind: "linear",
      linearAngle: getNumber(raw.linear.angle)
    };
  }

  return {
    kind: "unknown",
    raw
  };
}

function parseStroke(raw: unknown): Stroke {
  if (raw === "empty") {
    return { kind: "empty" };
  }

  if (!isObject(raw)) {
    return { kind: "unknown", raw };
  }

  const lineRaw = raw.line;
  if (!isObject(lineRaw)) {
    return { kind: "unknown", raw };
  }

  const line: StrokeLine = {
    width: getNumber(lineRaw.width),
    pattern: getString(lineRaw.pattern)
  };

  const colorRaw = lineRaw.color;
  if (isObject(colorRaw) && isObject(colorRaw.rgba)) {
    const rgbaRaw = colorRaw.rgba;
    line.color = {
      rgba: {
        colorSpace: getString(rgbaRaw.color_space),
        red: getNumber(rgbaRaw.red),
        green: getNumber(rgbaRaw.green),
        blue: getNumber(rgbaRaw.blue),
        alpha: getNumber(rgbaRaw.alpha)
      }
    };
  }

  return {
    kind: "line",
    line
  };
}

function parseGeometry(raw: unknown): Geometry | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    angle: getNumber(raw.angle),
    flipHorizontally: getBoolean(raw.flip_horizontally),
    widthValid: getBoolean(raw.width_valid),
    heightValid: getBoolean(raw.height_valid),
    position: parsePosition(raw.position),
    size: parseSize(raw.size)
  };
}

function parsePosition(raw: unknown): Position | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const x = getNumber(raw.x);
  const y = getNumber(raw.y);

  if (x === undefined || y === undefined) {
    return undefined;
  }

  return { x, y };
}

function parseSize(raw: unknown): Size | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const width = getNumber(raw.width);
  const height = getNumber(raw.height);

  if (width === undefined || height === undefined) {
    return undefined;
  }

  return { width, height };
}

function parsePath(raw: unknown): ParsedPath | undefined {
  if (!isObject(raw) || !isObject(raw.bezier)) {
    return undefined;
  }

  return {
    bezierPath: getString(raw.bezier.path),
    space: parseRectSpace(raw.bezier.space)
  };
}

function parseRectSpace(raw: unknown): ParsedPath["space"] | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    position: parsePosition(raw.position),
    size: parseSize(raw.size)
  };
}

function parseLayoutProperties(raw: unknown): ShapeLayoutProperties | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    verticalAlignment: getString(raw.vertical_alignment),
    shrinkToFit: getBoolean(raw.shrink_to_fit),
    padding: parseInsets(raw.padding)
  };
}

function parseInsets(raw: unknown): ShapeLayoutProperties["padding"] | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    top: getNumber(raw.top),
    left: getNumber(raw.left),
    right: getNumber(raw.right),
    bottom: getNumber(raw.bottom)
  };
}

function parseShadow(raw: unknown): ShapeShadow | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    dropShadow: parseShadowValue(raw.dropShadow),
    contactShadow: parseShadowValue(raw.contactShadow)
  };
}

function parseShadowValue(raw: unknown): ShapeShadow["dropShadow"] | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    color: parseColor(raw.color),
    opacity: getNumber(raw.opacity),
    angle: getNumber(raw.angle),
    radius: getNumber(raw.radius),
    offset: getNumber(raw.offset),
    height: getNumber(raw.height)
  };
}

function parseText(
  raw: unknown,
  options: Required<ParseOptions>,
  sourceIndex: number,
  addDiagnostic: (diagnostic: Diagnostic) => void
): ParsedText | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const attributedString = raw.attributed_string;
  if (!Array.isArray(attributedString)) {
    return undefined;
  }

  const content = typeof attributedString[0] === "string" ? attributedString[0] : "";
  const attributes = isObject(attributedString[1]) ? attributedString[1] : {};

  const scalarAttributes: Record<string, unknown> = {};
  const archivedAttributes: ParsedText["archivedAttributes"] = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (isLikelyBplistBase64(value)) {
      if (options.decodeArchives) {
        const decoded = decodeArchivedValue(value);
        archivedAttributes[key] = { key, ...decoded };

        if (!decoded.success) {
          addDiagnostic({
            code: "archive-decode-failed",
            severity: "warning",
            message: `Failed to decode archived attribute ${key}: ${decoded.error ?? "unknown error"}`,
            sourceIndex,
            path: `text.attributed_string.1.${key}`
          });
        }
      } else {
        archivedAttributes[key] = {
          key,
          success: false,
          rawBase64: value,
          decoded: null,
          error: "Archive decoding disabled"
        };
      }
    } else {
      scalarAttributes[key] = value;
    }
  }

  return {
    content,
    rawAttributes: attributes,
    scalarAttributes,
    archivedAttributes,
    style: parseTextStyle(scalarAttributes, archivedAttributes)
  };
}

function parseTextStyle(
  scalarAttributes: Record<string, unknown>,
  archivedAttributes: ParsedText["archivedAttributes"]
): TextStyle {
  const style: TextStyle = {};

  const nsFont = archivedAttributes.NSFont;
  if (nsFont?.success && isObject(nsFont.decoded) && isObject(nsFont.decoded.unarchived)) {
    const unarchived = nsFont.decoded.unarchived as Record<string, unknown>;
    if (typeof unarchived.NSName === "string") {
      style.fontFamily = unarchived.NSName;
    }
    if (typeof unarchived.NSSize === "number") {
      style.fontSize = unarchived.NSSize;
    }
  }

  const nsParagraphStyle = archivedAttributes.NSParagraphStyle;
  if (
    nsParagraphStyle?.success &&
    isObject(nsParagraphStyle.decoded) &&
    isObject(nsParagraphStyle.decoded.unarchived)
  ) {
    const unarchived = nsParagraphStyle.decoded.unarchived as Record<string, unknown>;
    style.paragraphAlignment = toParagraphAlignment(unarchived.NSAlignment);
    if (typeof unarchived.NSLineHeightMultiple === "number") {
      style.lineHeightMultiple = unarchived.NSLineHeightMultiple;
    }
  }

  const nsColor = archivedAttributes.NSColor;
  if (nsColor?.success) {
    const fontColor = tryExtractRgbColorFromArchive(nsColor.decoded);
    if (fontColor) {
      style.fontColor = fontColor;
    }
  }

  const underline = getNumberFromUnknown(scalarAttributes.NSUnderline);
  if (underline !== undefined) {
    style.underline = underline !== 0;
  }

  const strikethrough = getNumberFromUnknown(scalarAttributes.NSStrikethrough);
  if (strikethrough !== undefined) {
    style.strikethrough = strikethrough !== 0;
  }

  const superscript = getNumberFromUnknown(scalarAttributes.NSSuperScript);
  if (superscript !== undefined) {
    style.superscript = superscript;
  }

  const baselineOffset = getNumberFromUnknown(scalarAttributes.NSBaselineOffset);
  if (baselineOffset !== undefined) {
    style.baselineOffset = baselineOffset;
  }

  const ligature = getNumberFromUnknown(scalarAttributes.NSLigature);
  if (ligature !== undefined) {
    style.ligature = ligature !== 0;
  }

  return style;
}

function toParagraphAlignment(value: unknown): TextStyle["paragraphAlignment"] | undefined {
  if (value === 0 || value === "0") {
    return "start";
  }
  if (value === 1 || value === "1") {
    return "end";
  }
  if (value === 2 || value === "2") {
    return "center";
  }
  return undefined;
}

function tryExtractRgbColorFromArchive(decoded: unknown): string | undefined {
  const candidate = findColorString(decoded);
  if (!candidate) {
    return undefined;
  }

  const cleaned = candidate.replaceAll("\0", "").trim();
  const parts = cleaned
    .split(/\s+/)
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));

  if (parts.length < 3) {
    return undefined;
  }

  const red = clamp(parts[0], 0, 1);
  const green = clamp(parts[1], 0, 1);
  const blue = clamp(parts[2], 0, 1);
  const alpha = clamp(parts[3] ?? 1, 0, 1);

  const r = Math.round(red * 255);
  const g = Math.round(green * 255);
  const b = Math.round(blue * 255);

  if (alpha === 1) {
    return `rgb(${r},${g},${b})`;
  }

  return `rgba(${r},${g},${b},${Number(alpha.toFixed(4))})`;
}

function findColorString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const cleaned = value.replaceAll("\0", "").trim();
    if (/^\d*\.?\d+\s+\d*\.?\d+\s+\d*\.?\d+(\s+\d*\.?\d+)?$/.test(cleaned)) {
      return cleaned;
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findColorString(item);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (isObject(value)) {
    for (const nested of Object.values(value)) {
      const found = findColorString(nested);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

function parseLineType(raw: unknown): LineType | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  if (isObject(raw.corner)) {
    return {
      kind: "corner",
      point: parsePosition(raw.corner)
    };
  }

  if (isObject(raw.curved)) {
    return {
      kind: "curved",
      point: parsePosition(raw.curved)
    };
  }

  return {
    kind: "unknown",
    raw
  };
}

function parseConnectionLineEnd(raw: unknown): ConnectionLineEnd | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const anchorRaw = isObject(raw.anchor) ? raw.anchor : undefined;

  return {
    lineEnd: getString(raw.line_end),
    outset: getNumber(raw.outset),
    endPoint: parsePosition(raw.end_point),
    anchor: anchorRaw
      ? {
          objectId: getString(anchorRaw.object_id),
          magnet: getString(anchorRaw.magnet)
        }
      : undefined
  };
}

function parseResource(raw: unknown): ImageResource | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const indirect = isObject(raw.indirect)
    ? {
        identifier: getString(raw.indirect.identifier),
        filename: getString(raw.indirect.filename)
      }
    : undefined;

  return { indirect };
}

function resolveConnectionLineAnchors(
  shapes: ShapeObject[],
  connectionLines: ConnectionLineObject[],
  addDiagnostic: (diagnostic: Diagnostic) => void
): void {
  const shapeByIdentifier = new Map<string, ShapeObject>();
  for (const shape of shapes) {
    if (shape.identifier) {
      shapeByIdentifier.set(shape.identifier, shape);
    }
  }

  for (const line of connectionLines) {
    const headId = line.head?.anchor?.objectId;
    if (headId) {
      const headShape = shapeByIdentifier.get(headId);
      if (headShape?.identifier) {
        line.resolvedHeadShapeId = headShape.identifier;
      } else {
        addDiagnostic({
          code: "unresolved-connection-anchor",
          severity: "warning",
          message: `Could not resolve head anchor object_id ${headId}`,
          sourceIndex: line.sourceIndex,
          path: "head.anchor.object_id"
        });
      }
    }

    const tailId = line.tail?.anchor?.objectId;
    if (tailId) {
      const tailShape = shapeByIdentifier.get(tailId);
      if (tailShape?.identifier) {
        line.resolvedTailShapeId = tailShape.identifier;
      } else {
        addDiagnostic({
          code: "unresolved-connection-anchor",
          severity: "warning",
          message: `Could not resolve tail anchor object_id ${tailId}`,
          sourceIndex: line.sourceIndex,
          path: "tail.anchor.object_id"
        });
      }
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getNumberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
