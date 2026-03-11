export type ParseMode = "lenient";

export interface ParseOptions {
  mode?: ParseMode;
  decodeArchives?: boolean;
  collectDiagnostics?: boolean;
}

export type DiagnosticSeverity = "warning" | "error";

export interface Diagnostic {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  sourceIndex?: number;
  path?: string;
}

export interface ParseStats {
  totalObjects: number;
  shapeCount: number;
  connectionLineCount: number;
  imageCount: number;
  unknownCount: number;
  diagnosticCount: number;
}

export interface ParseResult {
  document: KeynoteClipboardDocument;
  diagnostics: Diagnostic[];
  stats: ParseStats;
}

export interface NormalizedTopLevelEntry {
  sourceIndex: number;
  raw: Record<string, unknown>;
}

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Geometry {
  angle?: number;
  flipHorizontally?: boolean;
  widthValid?: boolean;
  heightValid?: boolean;
  position?: Position;
  size?: Size;
}

export interface ColorRgba {
  colorSpace?: string;
  red?: number;
  green?: number;
  blue?: number;
  alpha?: number;
}

export interface Color {
  rgba?: ColorRgba;
}

export interface FillGradientStop {
  fraction?: number;
  inflection?: number;
  color?: Color;
}

export interface FillGradientFlavor {
  kind: "linear" | "unknown";
  linearAngle?: number;
  raw?: unknown;
}

export interface FillGradient {
  opacity?: number;
  flavor?: FillGradientFlavor;
  stops?: FillGradientStop[];
}

export interface Fill {
  color?: Color;
  gradient?: FillGradient;
}

export interface StrokeLine {
  width?: number;
  pattern?: string;
  color?: Color;
}

export interface Stroke {
  kind: "empty" | "line" | "unknown";
  line?: StrokeLine;
  raw?: unknown;
}

export interface ParsedPath {
  bezierPath?: string;
  space?: {
    position?: Position;
    size?: Size;
  };
}

export interface DecodedArchiveResult {
  success: boolean;
  rawBase64: string;
  decoded: unknown | null;
  error?: string;
}

export interface TextArchiveAttribute extends DecodedArchiveResult {
  key: string;
}

export interface ParsedText {
  content: string;
  rawAttributes: Record<string, unknown>;
  scalarAttributes: Record<string, unknown>;
  archivedAttributes: Record<string, TextArchiveAttribute>;
  style?: TextStyle;
}

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  paragraphAlignment?: "start" | "center" | "end";
  lineHeightMultiple?: number;
  underline?: boolean;
  strikethrough?: boolean;
  superscript?: number;
  baselineOffset?: number;
  ligature?: boolean;
}

export interface Insets {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
}

export interface ShapeLayoutProperties {
  verticalAlignment?: string;
  shrinkToFit?: boolean;
  padding?: Insets;
}

export interface ShapeShadowValue {
  color?: Color;
  opacity?: number;
  angle?: number;
  radius?: number;
  offset?: number;
  height?: number;
}

export interface ShapeShadow {
  dropShadow?: ShapeShadowValue;
  contactShadow?: ShapeShadowValue;
}

export interface BaseParsedObject {
  sourceIndex: number;
  rawTypeIdentifier: string;
  version?: string;
}

export interface ShapeObject extends BaseParsedObject {
  kind: "shape";
  identifier?: string;
  aspectRatioLocked?: boolean;
  head?: unknown;
  tail?: unknown;
  fill?: Fill;
  stroke: Stroke;
  geometry?: Geometry;
  text?: ParsedText;
  path?: ParsedPath;
  layoutProperties?: ShapeLayoutProperties;
  shadow?: ShapeShadow;
}

export interface ConnectionLineEndAnchor {
  objectId?: string;
  magnet?: string;
}

export interface ConnectionLineEnd {
  lineEnd?: string;
  outset?: number;
  endPoint?: Position;
  anchor?: ConnectionLineEndAnchor;
}

export interface LineType {
  kind: "corner" | "curved" | "unknown";
  point?: Position;
  raw?: unknown;
}

export interface ConnectionLineObject extends BaseParsedObject {
  kind: "connection-line";
  stroke: Stroke;
  head?: ConnectionLineEnd;
  tail?: ConnectionLineEnd;
  lineType?: LineType;
  resolvedHeadShapeId?: string;
  resolvedTailShapeId?: string;
}

export interface ImageResourceIndirect {
  identifier?: string;
  filename?: string;
}

export interface ImageResource {
  indirect?: ImageResourceIndirect;
}

export interface ImageObject extends BaseParsedObject {
  kind: "image";
  aspectRatioLocked?: boolean;
  stroke: Stroke;
  geometry?: Geometry;
  resource?: ImageResource;
}

export interface UnknownObject extends BaseParsedObject {
  kind: "unknown";
  raw: Record<string, unknown>;
}

export interface KeynoteClipboardDocument {
  sourceType: "canvas-object-1.0";
  shapes: ShapeObject[];
  connectionLines: ConnectionLineObject[];
  images: ImageObject[];
  unknownObjects: UnknownObject[];
}

export interface SvgOptions {
  canvas?: "auto-bounds";
  anchorMode?: "center";
  includeDiagnostics?: boolean;
  background?: string;
}

export interface SvgStats {
  renderedShapes: number;
  renderedConnectionLines: number;
  renderedTextNodes: number;
  renderedImagePlaceholders: number;
  skippedObjects: number;
}

export interface SvgResult {
  svg: string;
  diagnostics: Diagnostic[];
  stats: SvgStats;
}

export interface TikzOptions {
  canvas?: "auto-bounds";
  anchorMode?: "center";
  includeDiagnostics?: boolean;
  background?: string;
  standalone?: boolean;
}

export interface TikzStats {
  renderedShapes: number;
  renderedConnectionLines: number;
  renderedTextNodes: number;
  renderedImagePlaceholders: number;
  skippedObjects: number;
}

export interface TikzResult {
  tikz: string;
  diagnostics: Diagnostic[];
  stats: TikzStats;
}
