import { parseKeynoteClipboard } from "./parser.js";
import type {
  ConnectionLineObject,
  Diagnostic,
  Geometry,
  KeynoteClipboardDocument,
  ParseOptions,
  ParsedPath,
  ParsedText,
  Position,
  ShapeObject,
  Stroke,
  TikzOptions,
  TikzResult,
  TikzStats
} from "./types.js";

const PT_TO_CM = 2.54 / 72.27;

const DEFAULT_TIKZ_OPTIONS: Required<Pick<TikzOptions, "canvas" | "anchorMode" | "includeDiagnostics" | "standalone">> = {
  canvas: "auto-bounds",
  anchorMode: "center",
  includeDiagnostics: true,
  standalone: false
};

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Transform2D {
  scaleX: number;
  scaleY: number;
  tx: number;
  ty: number;
}

interface PathPlacement {
  matrix?: Transform2D;
  bounds?: Bounds;
}

interface TikzRenderContext {
  shadingIdCounter: number;
  shadings: string[];
}

interface TikzStroke {
  color: string;
  opacity: number;
  widthPt: number;
  dasharray?: string;
  linecap?: "round";
}

interface TextPlacement extends Position {
  dominantBaseline: "middle" | "text-before-edge" | "text-after-edge";
}

interface PathToken {
  kind: "command" | "number";
  value: string;
}

export function toTikz(document: KeynoteClipboardDocument, options: TikzOptions = {}): TikzResult {
  const opts = {
    ...DEFAULT_TIKZ_OPTIONS,
    ...options
  };

  const diagnostics: Diagnostic[] = [];
  const stats: TikzStats = {
    renderedShapes: 0,
    renderedConnectionLines: 0,
    renderedTextNodes: 0,
    renderedImagePlaceholders: 0,
    skippedObjects: 0
  };

  const addDiagnostic = (diagnostic: Diagnostic): void => {
    diagnostics.push(diagnostic);
  };

  let aggregateBounds: Bounds | undefined;
  const shapeBounds = new Map<number, Bounds | undefined>();

  for (const shape of document.shapes) {
    const renderedBounds = shapeRenderBounds(shape);
    shapeBounds.set(shape.sourceIndex, renderedBounds);
    aggregateBounds = mergeBounds(aggregateBounds, renderedBounds);
  }

  for (const line of document.connectionLines) {
    const lineBounds = connectionLineBounds(line);
    aggregateBounds = mergeBounds(aggregateBounds, lineBounds);
  }

  for (const image of document.images) {
    aggregateBounds = mergeBounds(aggregateBounds, geometryBounds(image.geometry));
  }

  const canvasBounds = finalizeCanvasBounds(aggregateBounds);

  const context: TikzRenderContext = {
    shadingIdCounter: 0,
    shadings: []
  };

  const contentParts: string[] = [];

  for (const shape of document.shapes) {
    const rendered = renderShape(shape, shapeBounds.get(shape.sourceIndex), canvasBounds, contentParts, context, addDiagnostic);
    if (rendered.renderedShape) {
      stats.renderedShapes += 1;
    } else {
      stats.skippedObjects += 1;
    }
    if (rendered.renderedText) {
      stats.renderedTextNodes += 1;
    }
  }

  for (const line of document.connectionLines) {
    const rendered = renderConnectionLine(line, canvasBounds, contentParts, addDiagnostic);
    if (rendered) {
      stats.renderedConnectionLines += 1;
    } else {
      stats.skippedObjects += 1;
    }
  }

  for (const image of document.images) {
    const rendered = renderImagePlaceholder(image, canvasBounds, contentParts, addDiagnostic);
    if (rendered) {
      stats.renderedImagePlaceholders += 1;
    } else {
      stats.skippedObjects += 1;
    }
  }

  const widthCm = ptToCmNumber(canvasBounds.maxX - canvasBounds.minX);
  const heightCm = ptToCmNumber(canvasBounds.maxY - canvasBounds.minY);
  const background = options.background ? cssColorToTikzColor(options.background) : undefined;

  const preface: string[] = [];
  if (!opts.standalone) {
    preface.push("% Requires: \\\\usetikzlibrary{arrows.meta,shadows}");
  }
  preface.push(...context.shadings);

  const pictureParts = [
    `\\begin{tikzpicture}[x=1cm,y=1cm,line cap=butt,line join=round]`,
    background
      ? `  \\path[fill=${background}] (0,0) rectangle (${formatTikzNum(widthCm)},${formatTikzNum(heightCm)});`
      : "",
    ...contentParts,
    "\\end{tikzpicture}"
  ].filter(Boolean);

  const snippet = [...preface, ...pictureParts].filter(Boolean).join("\n");
  const tikz = opts.standalone ? wrapStandalone(snippet) : snippet;

  return {
    tikz,
    diagnostics: opts.includeDiagnostics ? diagnostics : [],
    stats
  };
}

export function toTikzFromClipboard(
  input: string | unknown,
  parseOptions: ParseOptions = {},
  tikzOptions: TikzOptions = {}
): TikzResult {
  const parseResult = parseKeynoteClipboard(input, parseOptions);
  const tikzResult = toTikz(parseResult.document, tikzOptions);

  return {
    tikz: tikzResult.tikz,
    diagnostics: tikzOptions.includeDiagnostics === false
      ? []
      : [...parseResult.diagnostics, ...tikzResult.diagnostics],
    stats: tikzResult.stats
  };
}

function renderShape(
  shape: ShapeObject,
  fallbackBounds: Bounds | undefined,
  canvasBounds: Bounds,
  out: string[],
  context: TikzRenderContext,
  addDiagnostic: (diagnostic: Diagnostic) => void
): { renderedShape: boolean; renderedText: boolean } {
  let renderedShape = false;
  let renderedText = false;

  const fill = resolveShapeFill(shape, context);
  const stroke = toStroke(shape.stroke);
  const markerOption = resolveShapeMarkers(shape);
  const shadowOption = resolveShapeShadow(shape);

  const drawOptions = buildPathOptions(fill, stroke, markerOption, shadowOption);

  if (shape.path?.bezierPath) {
    const pathBounds = parsePathBounds(shape.path.bezierPath);
    const placement = computePathPlacement(shape.geometry, shape.path.space, pathBounds);
    const convertedPath = svgPathToTikz(shape.path.bezierPath, placement.matrix, canvasBounds);

    if (convertedPath) {
      out.push(`  \\path[${drawOptions}] ${convertedPath};`);
      renderedShape = true;
    } else if (shape.geometry) {
      const rectPath = rectanglePath(shape.geometry, canvasBounds);
      if (rectPath) {
        out.push(`  \\path[${drawOptions}] ${rectPath};`);
        renderedShape = true;
        addDiagnostic({
          code: "tikz-shape-path-fallback",
          severity: "warning",
          message: "Shape path contained unsupported SVG commands; rendered geometry rectangle fallback",
          sourceIndex: shape.sourceIndex
        });
      }
    }
  } else {
    const rectPath = rectanglePath(shape.geometry, canvasBounds);
    if (rectPath) {
      out.push(`  \\path[${drawOptions}] ${rectPath};`);
      renderedShape = true;
      addDiagnostic({
        code: "tikz-shape-rect-fallback",
        severity: "warning",
        message: "Shape path missing; rendered rectangle fallback from geometry",
        sourceIndex: shape.sourceIndex
      });
    } else {
      addDiagnostic({
        code: "tikz-shape-skipped",
        severity: "warning",
        message: "Shape skipped because both path and geometry were missing",
        sourceIndex: shape.sourceIndex
      });
    }
  }

  const textModel = shape.text;
  const text = textModel?.content?.trim();
  if (text && textModel) {
    const textStyle = extractTextStyle(textModel, shape, addDiagnostic, shape.sourceIndex);
    const textPos = textAnchor(shape, fallbackBounds, textStyle.textAnchor);
    if (textPos) {
      const nodeOptions = buildTextNodeOptions(textStyle, textPos.dominantBaseline);
      const content = formatTextContent(text, textStyle);
      const coord = toTikzCoord(textPos.x, textPos.y, canvasBounds);
      out.push(`  \\node[${nodeOptions}] at ${coord} {${content}};`);
      renderedText = true;
    } else {
      addDiagnostic({
        code: "tikz-text-skipped",
        severity: "warning",
        message: "Text skipped because no placement geometry was available",
        sourceIndex: shape.sourceIndex
      });
    }
  }

  return { renderedShape, renderedText };
}

function renderConnectionLine(
  line: ConnectionLineObject,
  canvasBounds: Bounds,
  out: string[],
  addDiagnostic: (diagnostic: Diagnostic) => void
): boolean {
  const head = line.head?.endPoint;
  const tail = line.tail?.endPoint;
  if (!head || !tail) {
    addDiagnostic({
      code: "tikz-connection-line-skipped",
      severity: "warning",
      message: "Connection line skipped because head/tail endpoints were missing",
      sourceIndex: line.sourceIndex
    });
    return false;
  }

  const stroke = toStroke(line.stroke);
  const options: string[] = [];
  if (stroke.color !== "none") {
    options.push(`draw=${stroke.color}`);
    options.push(`draw opacity=${formatTikzNum(stroke.opacity)}`);
    if (stroke.widthPt > 0) {
      options.push(`line width=${formatTikzNum(ptToCmNumber(stroke.widthPt))}cm`);
    }
  } else {
    options.push("draw=none");
  }
  if (stroke.dasharray) {
    options.push(stroke.dasharray);
  }
  if (stroke.linecap) {
    options.push("line cap=round");
  }

  let path = `${toTikzCoord(head.x, head.y, canvasBounds)} -- ${toTikzCoord(tail.x, tail.y, canvasBounds)}`;

  if (line.lineType?.kind === "corner" && line.lineType.point) {
    const corner = line.lineType.point;
    path = `${toTikzCoord(head.x, head.y, canvasBounds)} -- ${toTikzCoord(corner.x, corner.y, canvasBounds)} -- ${toTikzCoord(tail.x, tail.y, canvasBounds)}`;
  } else if (line.lineType?.kind === "curved" && line.lineType.point) {
    const curve = line.lineType.point;
    path = `${toTikzCoord(head.x, head.y, canvasBounds)} .. controls ${toTikzCoord(curve.x, curve.y, canvasBounds)} .. ${toTikzCoord(tail.x, tail.y, canvasBounds)}`;
  }

  out.push(`  \\draw[${options.join(",")}] ${path};`);
  return true;
}

function renderImagePlaceholder(
  image: KeynoteClipboardDocument["images"][number],
  canvasBounds: Bounds,
  out: string[],
  addDiagnostic: (diagnostic: Diagnostic) => void
): boolean {
  const bounds = geometryBounds(image.geometry);
  if (!bounds) {
    addDiagnostic({
      code: "tikz-image-skipped",
      severity: "warning",
      message: "Image placeholder skipped because geometry was missing",
      sourceIndex: image.sourceIndex
    });
    return false;
  }

  const label = image.resource?.indirect?.filename ?? image.resource?.indirect?.identifier ?? "image";
  const min = toTikzPoint(bounds.minX, bounds.maxY, canvasBounds);
  const max = toTikzPoint(bounds.maxX, bounds.minY, canvasBounds);
  const center = toTikzPoint((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, canvasBounds);

  out.push(
    `  \\path[draw={rgb,255:red,102;green,102;blue,102},fill={rgb,255:red,245;green,245;blue,245},line width=${formatTikzNum(ptToCmNumber(1))}cm,dash pattern=on ${formatTikzNum(ptToCmNumber(6))}cm off ${formatTikzNum(ptToCmNumber(4))}cm] (${formatTikzNum(min.x)},${formatTikzNum(min.y)}) rectangle (${formatTikzNum(max.x)},${formatTikzNum(max.y)});`
  );
  out.push(
    `  \\node[anchor=center,text={rgb,255:red,68;green,68;blue,68},font=\\fontsize{12}{14.4}\\selectfont] at (${formatTikzNum(center.x)},${formatTikzNum(center.y)}) {${escapeLatex(label)}};`
  );

  return true;
}

function buildPathOptions(
  fill: { fillColor?: string; fillOpacity?: number; shadingName?: string; shadingAngle?: number },
  stroke: TikzStroke,
  markerOption: string | undefined,
  shadowOption: string | undefined
): string {
  const options: string[] = [];

  if (fill.shadingName) {
    options.push("draw");
    options.push(`shading=${fill.shadingName}`);
    if (fill.shadingAngle !== undefined) {
      options.push(`shading angle=${formatTikzNum(fill.shadingAngle)}`);
    }
  } else if (fill.fillColor) {
    options.push(`fill=${fill.fillColor}`);
  } else {
    options.push("fill=none");
  }

  if (fill.fillOpacity !== undefined) {
    options.push(`fill opacity=${formatTikzNum(fill.fillOpacity)}`);
  }

  if (stroke.color !== "none") {
    options.push(`draw=${stroke.color}`);
    options.push(`draw opacity=${formatTikzNum(stroke.opacity)}`);
    if (stroke.widthPt > 0) {
      options.push(`line width=${formatTikzNum(ptToCmNumber(stroke.widthPt))}cm`);
    }
  } else {
    options.push("draw=none");
  }

  if (stroke.dasharray) {
    options.push(stroke.dasharray);
  }
  if (stroke.linecap) {
    options.push("line cap=round");
  }
  if (markerOption) {
    options.push(markerOption);
  }
  if (shadowOption) {
    options.push(shadowOption);
  }

  return options.join(",");
}

function resolveShapeFill(
  shape: ShapeObject,
  context: TikzRenderContext
): { fillColor?: string; fillOpacity?: number; shadingName?: string; shadingAngle?: number } {
  const gradient = shape.fill?.gradient;
  if (gradient?.flavor?.kind === "linear" && gradient.stops && gradient.stops.length > 0) {
    const shading = registerLinearGradient(gradient, context);
    if (shading) {
      return {
        shadingName: shading,
        shadingAngle: gradient.flavor.linearAngle ?? 0,
        fillOpacity: clamp(gradient.opacity ?? 1, 0, 1)
      };
    }
  }

  const rgba = shape.fill?.color?.rgba;
  if (!rgba) {
    return {};
  }

  const fillColor = rgbaToTikzColor(rgba.red, rgba.green, rgba.blue);
  const fillOpacity = clamp(rgba.alpha ?? 1, 0, 1);
  return {
    fillColor,
    fillOpacity
  };
}

function registerLinearGradient(
  gradient: NonNullable<ShapeObject["fill"]>["gradient"],
  context: TikzRenderContext
): string | undefined {
  if (!gradient?.stops || gradient.stops.length === 0) {
    return undefined;
  }

  const sortedStops = [...gradient.stops]
    .filter((stop): stop is NonNullable<typeof stop> => Boolean(stop))
    .sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0));

  if (sortedStops.length === 0) {
    return undefined;
  }

  const spec: string[] = [];
  for (const stop of sortedStops) {
    const offset = clamp01(stop.fraction ?? 0) * 100;
    const color = rgbaToTikzColor(stop.color?.rgba?.red, stop.color?.rgba?.green, stop.color?.rgba?.blue);
    spec.push(`color(${formatTikzNum(offset)}bp)=(${color})`);
  }

  const id = `kcshade${context.shadingIdCounter++}`;
  context.shadings.push(`\\pgfdeclarehorizontalshading{${id}}{100bp}{${spec.join("; ")}}`);
  return id;
}

function resolveShapeShadow(shape: ShapeObject): string | undefined {
  const selected = shape.shadow?.dropShadow ?? shape.shadow?.contactShadow;
  if (!selected) {
    return undefined;
  }

  const angle = selected.angle ?? 0;
  const offset = selected.offset ?? 0;
  const radians = (angle * Math.PI) / 180;
  const dxPt = Math.cos(radians) * offset;
  const dyPtDown = -Math.sin(radians) * offset + (selected.height ?? 0);
  const dyPtUp = -dyPtDown;
  const color = rgbaToTikzColor(selected.color?.rgba?.red, selected.color?.rgba?.green, selected.color?.rgba?.blue);
  const opacity = clamp((selected.opacity ?? 1) * (selected.color?.rgba?.alpha ?? 1), 0, 1);

  return `drop shadow={shadow xshift=${formatTikzNum(ptToCmNumber(dxPt))}cm,shadow yshift=${formatTikzNum(ptToCmNumber(dyPtUp))}cm,opacity=${formatTikzNum(opacity)},fill=${color}}`;
}

function resolveShapeMarkers(shape: ShapeObject): string | undefined {
  const startTip = markerToArrowTip(normalizeMarkerStyle(shape.tail));
  const endTip = markerToArrowTip(normalizeMarkerStyle(shape.head));
  if (!startTip && !endTip) {
    return undefined;
  }

  if (startTip && endTip) {
    return `arrows={{${startTip}}-{${endTip}}}`;
  }

  if (startTip) {
    return `arrows={{${startTip}}-}`;
  }

  return `arrows={-{${endTip}}}`;
}

function normalizeMarkerStyle(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  if (raw === "none") {
    return undefined;
  }

  return raw;
}

function markerToArrowTip(style: string | undefined): string | undefined {
  switch (style) {
    case "simple_arrow":
      return "Stealth";
    case "open_arrow":
      return "Stealth[open]";
    case "filled_arrow":
      return "Latex";
    case "inverted_arrow":
      return "Stealth[reversed]";
    case "filled_circle":
      return "Circle";
    case "open_circle":
      return "Circle[open]";
    case "filled_square":
      return "Square";
    case "open_square":
      return "Square[open]";
    case "filled_diamond":
      return "Diamond";
    case "line":
      return "Bar";
    default:
      return undefined;
  }
}

function toStroke(stroke: Stroke): TikzStroke {
  if (stroke.kind === "line") {
    const rgba = stroke.line?.color?.rgba;
    const color = rgba ? rgbaToTikzColor(rgba.red, rgba.green, rgba.blue) : "black";
    const opacity = clamp(rgba?.alpha ?? 1, 0, 1);
    const widthPt = stroke.line?.width ?? 1;
    const mapped = mapDashPattern(stroke.line?.pattern, widthPt);

    return {
      color,
      opacity,
      widthPt,
      dasharray: mapped?.dasharray,
      linecap: mapped?.roundCaps ? "round" : undefined
    };
  }

  if (stroke.kind === "empty") {
    return { color: "none", opacity: 1, widthPt: 0 };
  }

  return { color: "black", opacity: 1, widthPt: 1 };
}

function mapDashPattern(
  pattern: string | undefined,
  widthPt: number
): { dasharray?: string; roundCaps?: boolean } | undefined {
  if (!pattern || pattern === "solid") {
    return undefined;
  }

  const w = Math.max(widthPt, 0.1);
  const onOff = (on: number, off: number): string => {
    return `dash pattern=on ${formatTikzNum(ptToCmNumber(on))}cm off ${formatTikzNum(ptToCmNumber(off))}cm`;
  };

  switch (pattern) {
    case "short_dash":
      return { dasharray: onOff(w * 2, w * 2) };
    case "medium_dash":
      return { dasharray: onOff(w * 4, w * 2.5) };
    case "long_dash":
      return { dasharray: onOff(w * 7, w * 3) };
    case "round_dash":
      return { dasharray: onOff(w * 0.1, w * 2.5), roundCaps: true };
    default:
      return undefined;
  }
}

function extractTextStyle(
  text: ParsedText,
  shape: ShapeObject,
  addDiagnostic: (diagnostic: Diagnostic) => void,
  sourceIndex: number
): {
  fontFamily: string;
  fontSize: number;
  fill: string;
  textAnchor: "start" | "middle" | "end";
  underline: boolean;
  strikethrough: boolean;
} {
  const textStyle = text.style;
  const hasStyleFont = typeof textStyle?.fontFamily === "string" || typeof textStyle?.fontSize === "number";
  let fontFamily = textStyle?.fontFamily ?? "sans-serif";
  let fontSize = textStyle?.fontSize ?? 16;
  const fallbackFill = shape.fill?.color?.rgba
    ? rgbaToTikzColor(shape.fill.color.rgba.red, shape.fill.color.rgba.green, shape.fill.color.rgba.blue)
    : "black";
  let fill = cssColorToTikzColor(textStyle?.fontColor) ?? fallbackFill;
  let textAnchor: "start" | "middle" | "end" = "start";
  if (textStyle?.paragraphAlignment === "start") {
    textAnchor = "start";
  } else if (textStyle?.paragraphAlignment === "end") {
    textAnchor = "end";
  } else if (textStyle?.paragraphAlignment === "center") {
    textAnchor = "middle";
  }

  const nsFont = text.archivedAttributes.NSFont;
  if (
    !hasStyleFont &&
    fontFamily === "sans-serif" &&
    fontSize === 16 &&
    nsFont?.success &&
    isObject(nsFont.decoded) &&
    isObject(nsFont.decoded.unarchived)
  ) {
    const unarchived = nsFont.decoded.unarchived as Record<string, unknown>;
    if (typeof unarchived.NSName === "string") {
      fontFamily = unarchived.NSName;
    }
    if (typeof unarchived.NSSize === "number") {
      fontSize = unarchived.NSSize;
    }
  } else if (!hasStyleFont && (!nsFont?.success || !isObject(nsFont.decoded) || !isObject(nsFont.decoded.unarchived))) {
    addDiagnostic({
      code: "tikz-text-font-fallback",
      severity: "warning",
      message: "Could not decode NSFont; using fallback text font",
      sourceIndex,
      path: "text.attributed_string.1.NSFont"
    });
  }

  if (!fill) {
    fill = "black";
  }

  return {
    fontFamily,
    fontSize,
    fill,
    textAnchor,
    underline: Boolean(textStyle?.underline),
    strikethrough: Boolean(textStyle?.strikethrough)
  };
}

function buildTextNodeOptions(
  style: {
    fontFamily: string;
    fontSize: number;
    fill: string;
    textAnchor: "start" | "middle" | "end";
  },
  dominantBaseline: "middle" | "text-before-edge" | "text-after-edge"
): string {
  const anchor = tikzTextAnchor(style.textAnchor, dominantBaseline);
  const lineHeight = style.fontSize * 1.2;
  const options = [
    `anchor=${anchor}`,
    `text=${style.fill}`,
    `font=\\fontsize{${formatTikzNum(style.fontSize)}}{${formatTikzNum(lineHeight)}}\\selectfont`
  ];

  return options.join(",");
}

function tikzTextAnchor(
  horizontalAnchor: "start" | "middle" | "end",
  dominantBaseline: "middle" | "text-before-edge" | "text-after-edge"
): string {
  const horizontal = horizontalAnchor === "start" ? "west" : horizontalAnchor === "end" ? "east" : "center";

  if (dominantBaseline === "text-before-edge") {
    return horizontal === "center" ? "north" : `north ${horizontal}`;
  }
  if (dominantBaseline === "text-after-edge") {
    return horizontal === "center" ? "south" : `south ${horizontal}`;
  }
  return horizontal;
}

function formatTextContent(
  text: string,
  style: { underline: boolean; strikethrough: boolean }
): string {
  const escaped = escapeLatex(text);
  if (style.underline) {
    return `\\underline{${escaped}}`;
  }
  if (style.strikethrough) {
    return `\\sout{${escaped}}`;
  }
  return escaped;
}

function svgPathToTikz(pathData: string, matrix: Transform2D | undefined, canvasBounds: Bounds): string | undefined {
  const tokens = tokenizePath(pathData);
  if (tokens.length === 0) {
    return undefined;
  }

  const parts: string[] = [];
  let i = 0;
  let cmd = "";
  let current: Position = { x: 0, y: 0 };
  let subStart: Position = { x: 0, y: 0 };
  let lastControl: Position | undefined;

  const nextNumber = (): number | undefined => {
    const token = tokens[i];
    if (!token || token.kind !== "number") {
      return undefined;
    }
    i += 1;
    return Number(token.value);
  };

  const transformedCoord = (x: number, y: number): string => {
    const point = applyTransform({ x, y }, matrix);
    return toTikzCoord(point.x, point.y, canvasBounds);
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "command") {
      cmd = token.value;
      i += 1;
    }

    if (!cmd) {
      return undefined;
    }

    const absolute = cmd === cmd.toUpperCase();
    const command = cmd.toUpperCase();

    const readPoint = (): Position | undefined => {
      const x = nextNumber();
      const y = nextNumber();
      if (x === undefined || y === undefined) {
        return undefined;
      }

      if (absolute) {
        return { x, y };
      }

      return { x: current.x + x, y: current.y + y };
    };

    if (command === "M") {
      const point = readPoint();
      if (!point) {
        return undefined;
      }
      current = point;
      subStart = point;
      parts.push(transformedCoord(point.x, point.y));
      lastControl = undefined;

      while (true) {
        const lookahead = tokens[i];
        if (!lookahead || lookahead.kind === "command") {
          break;
        }
        const nextPoint = readPoint();
        if (!nextPoint) {
          return undefined;
        }
        parts.push(`-- ${transformedCoord(nextPoint.x, nextPoint.y)}`);
        current = nextPoint;
      }
      continue;
    }

    if (command === "L") {
      while (true) {
        const point = readPoint();
        if (!point) {
          break;
        }
        parts.push(`-- ${transformedCoord(point.x, point.y)}`);
        current = point;
        lastControl = undefined;
      }
      continue;
    }

    if (command === "H") {
      while (true) {
        const x = nextNumber();
        if (x === undefined) {
          break;
        }
        const nx = absolute ? x : current.x + x;
        current = { x: nx, y: current.y };
        parts.push(`-- ${transformedCoord(current.x, current.y)}`);
        lastControl = undefined;
      }
      continue;
    }

    if (command === "V") {
      while (true) {
        const y = nextNumber();
        if (y === undefined) {
          break;
        }
        const ny = absolute ? y : current.y + y;
        current = { x: current.x, y: ny };
        parts.push(`-- ${transformedCoord(current.x, current.y)}`);
        lastControl = undefined;
      }
      continue;
    }

    if (command === "C") {
      while (true) {
        const p1 = readPoint();
        const p2 = readPoint();
        const p = readPoint();
        if (!p1 || !p2 || !p) {
          break;
        }
        parts.push(`.. controls ${transformedCoord(p1.x, p1.y)} and ${transformedCoord(p2.x, p2.y)} .. ${transformedCoord(p.x, p.y)}`);
        current = p;
        lastControl = p2;
      }
      continue;
    }

    if (command === "S") {
      while (true) {
        const p2 = readPoint();
        const p = readPoint();
        if (!p2 || !p) {
          break;
        }
        const p1 = lastControl ? reflectPoint(lastControl, current) : current;
        parts.push(`.. controls ${transformedCoord(p1.x, p1.y)} and ${transformedCoord(p2.x, p2.y)} .. ${transformedCoord(p.x, p.y)}`);
        current = p;
        lastControl = p2;
      }
      continue;
    }

    if (command === "Q") {
      while (true) {
        const c = readPoint();
        const p = readPoint();
        if (!c || !p) {
          break;
        }
        parts.push(`.. controls ${transformedCoord(c.x, c.y)} .. ${transformedCoord(p.x, p.y)}`);
        current = p;
        lastControl = c;
      }
      continue;
    }

    if (command === "T") {
      while (true) {
        const p = readPoint();
        if (!p) {
          break;
        }
        const c = lastControl ? reflectPoint(lastControl, current) : current;
        parts.push(`.. controls ${transformedCoord(c.x, c.y)} .. ${transformedCoord(p.x, p.y)}`);
        current = p;
        lastControl = c;
      }
      continue;
    }

    if (command === "Z") {
      parts.push("-- cycle");
      current = subStart;
      lastControl = undefined;
      continue;
    }

    return undefined;
  }

  return parts.join(" ");
}

function tokenizePath(pathData: string): PathToken[] {
  const tokens: PathToken[] = [];
  const matcher = /([a-zA-Z])|(-?\d*\.?\d+(?:e[+-]?\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(pathData)) !== null) {
    if (match[1]) {
      tokens.push({ kind: "command", value: match[1] });
    } else if (match[2]) {
      tokens.push({ kind: "number", value: match[2] });
    }
  }
  return tokens;
}

function reflectPoint(control: Position, pivot: Position): Position {
  return {
    x: pivot.x * 2 - control.x,
    y: pivot.y * 2 - control.y
  };
}

function applyTransform(point: Position, matrix: Transform2D | undefined): Position {
  if (!matrix) {
    return point;
  }

  return {
    x: point.x * matrix.scaleX + matrix.tx,
    y: point.y * matrix.scaleY + matrix.ty
  };
}

function rectanglePath(geometry: Geometry | undefined, canvasBounds: Bounds): string | undefined {
  const bounds = geometryBounds(geometry);
  if (!bounds) {
    return undefined;
  }

  const p1 = toTikzCoord(bounds.minX, bounds.minY, canvasBounds);
  const p2 = toTikzCoord(bounds.maxX, bounds.minY, canvasBounds);
  const p3 = toTikzCoord(bounds.maxX, bounds.maxY, canvasBounds);
  const p4 = toTikzCoord(bounds.minX, bounds.maxY, canvasBounds);
  return `${p1} -- ${p2} -- ${p3} -- ${p4} -- cycle`;
}

function shapeRenderBounds(shape: ShapeObject): Bounds | undefined {
  const geometry = geometryBounds(shape.geometry);
  if (shape.path?.bezierPath) {
    const pathBounds = parsePathBounds(shape.path.bezierPath);
    const placement = computePathPlacement(shape.geometry, shape.path.space, pathBounds);
    return mergeBounds(geometry, placement.bounds);
  }
  return geometry;
}

function connectionLineBounds(line: ConnectionLineObject): Bounds | undefined {
  const head = line.head?.endPoint;
  const tail = line.tail?.endPoint;
  if (!head || !tail) {
    return undefined;
  }

  let bounds = pointsBounds([head, tail, line.lineType?.point].filter((v): v is Position => Boolean(v)));
  const stroke = toStroke(line.stroke);
  bounds = inflateBounds(bounds, stroke.widthPt / 2);
  return bounds;
}

function computePathPlacement(
  geometry: Geometry | undefined,
  pathSpace: ParsedPath["space"] | undefined,
  pathBounds: Bounds | undefined
): PathPlacement {
  if (!pathBounds) {
    return { bounds: pathBounds };
  }

  if (geometry?.position && geometry.size && pathSpace?.position && pathSpace.size) {
    const sourceWidth = pathSpace.size.width;
    const sourceHeight = pathSpace.size.height;
    if (sourceWidth > 0 && sourceHeight > 0) {
      const scaleX = geometry.size.width / sourceWidth;
      const scaleY = geometry.size.height / sourceHeight;
      const tx = geometry.position.x - pathSpace.position.x * scaleX;
      const ty = geometry.position.y - pathSpace.position.y * scaleY;

      return {
        matrix: { scaleX, scaleY, tx, ty },
        bounds: {
          minX: pathBounds.minX * scaleX + tx,
          minY: pathBounds.minY * scaleY + ty,
          maxX: pathBounds.maxX * scaleX + tx,
          maxY: pathBounds.maxY * scaleY + ty
        }
      };
    }
  }

  if (!geometry?.position || !geometry.size) {
    return { bounds: pathBounds };
  }

  const width = geometry.size.width;
  const height = geometry.size.height;

  if (width <= 0 || height <= 0) {
    return { bounds: pathBounds };
  }

  const overshootX = Math.max(width, 10) * 0.2;
  const overshootY = Math.max(height, 10) * 0.2;
  const localExtentLimit = Math.max(width, height, 100) * 4;
  const localLike =
    pathBounds.minX >= -overshootX &&
    pathBounds.minY >= -overshootY &&
    pathBounds.maxX <= width + overshootX &&
    pathBounds.maxY <= height + overshootY &&
    Math.max(
      Math.abs(pathBounds.minX),
      Math.abs(pathBounds.minY),
      Math.abs(pathBounds.maxX),
      Math.abs(pathBounds.maxY)
    ) <= localExtentLimit;

  if (!localLike) {
    return { bounds: pathBounds };
  }

  const normalizedFrame = normalizeLocalPathFrame(pathBounds, width, height);
  const frameWidth = Math.max(normalizedFrame.maxX - normalizedFrame.minX, 1e-6);
  const frameHeight = Math.max(normalizedFrame.maxY - normalizedFrame.minY, 1e-6);
  const scaleX = width / frameWidth;
  const scaleY = height / frameHeight;
  const tx = geometry.position.x - normalizedFrame.minX * scaleX;
  const ty = geometry.position.y - normalizedFrame.minY * scaleY;

  const bounds: Bounds = {
    minX: pathBounds.minX * scaleX + tx,
    minY: pathBounds.minY * scaleY + ty,
    maxX: pathBounds.maxX * scaleX + tx,
    maxY: pathBounds.maxY * scaleY + ty
  };

  return {
    matrix: { scaleX, scaleY, tx, ty },
    bounds
  };
}

function normalizeLocalPathFrame(pathBounds: Bounds, width: number, height: number): Bounds {
  const pbWidth = pathBounds.maxX - pathBounds.minX;
  const pbHeight = pathBounds.maxY - pathBounds.minY;

  let minX = pathBounds.minX;
  let maxX = pathBounds.maxX;
  let minY = pathBounds.minY;
  let maxY = pathBounds.maxY;

  const excessX = pbWidth - width;
  if (excessX > 0) {
    const leftExcess = -pathBounds.minX;
    const rightExcess = pathBounds.maxX - width;
    if (leftExcess > 0 && rightExcess > 0 && Math.abs(leftExcess - rightExcess) <= Math.max(width, 1) * 0.05) {
      minX = 0;
      maxX = width;
    }
  }

  const excessY = pbHeight - height;
  if (excessY > 0) {
    const topExcess = -pathBounds.minY;
    const bottomExcess = pathBounds.maxY - height;
    if (topExcess > 0 && bottomExcess > 0 && Math.abs(topExcess - bottomExcess) <= Math.max(height, 1) * 0.05) {
      minY = 0;
      maxY = height;
    }
  }

  return { minX, minY, maxX, maxY };
}

function textAnchor(
  shape: ShapeObject,
  fallbackBounds: Bounds | undefined,
  horizontalAnchor: "start" | "middle" | "end"
): TextPlacement | undefined {
  const geometry = shape.geometry;
  if (geometry?.position && geometry.size) {
    const topLeft = geometry.position;
    const size = geometry.size;
    const padding = shape.layoutProperties?.padding;
    const padLeft = padding?.left ?? 0;
    const padRight = padding?.right ?? 0;
    const padTop = padding?.top ?? 0;
    const padBottom = padding?.bottom ?? 0;

    let x = topLeft.x + size.width / 2;
    if (horizontalAnchor === "start") {
      x = topLeft.x + padLeft;
    } else if (horizontalAnchor === "end") {
      x = topLeft.x + size.width - padRight;
    }

    const vertical = shape.layoutProperties?.verticalAlignment;
    let dominantBaseline: "middle" | "text-before-edge" | "text-after-edge" = "middle";
    let y = topLeft.y + size.height / 2;
    if (vertical === "top") {
      y = topLeft.y + padTop;
      dominantBaseline = "text-before-edge";
    } else if (vertical === "bottom") {
      y = topLeft.y + size.height - padBottom;
      dominantBaseline = "text-after-edge";
    }

    return { x, y, dominantBaseline };
  }

  if (geometry?.position) {
    return { ...geometry.position, dominantBaseline: "middle" };
  }

  if (fallbackBounds) {
    return {
      x: (fallbackBounds.minX + fallbackBounds.maxX) / 2,
      y: (fallbackBounds.minY + fallbackBounds.maxY) / 2,
      dominantBaseline: "middle"
    };
  }

  return undefined;
}

function wrapStandalone(snippet: string): string {
  return [
    "\\documentclass[tikz]{standalone}",
    "\\usepackage{tikz}",
    "\\usetikzlibrary{arrows.meta,shadows}",
    "\\usepackage[normalem]{ulem}",
    "\\begin{document}",
    snippet,
    "\\end{document}"
  ].join("\n");
}

function toTikzCoord(xPt: number, yPt: number, canvasBounds: Bounds): string {
  const point = toTikzPoint(xPt, yPt, canvasBounds);
  return `(${formatTikzNum(point.x)},${formatTikzNum(point.y)})`;
}

function toTikzPoint(xPt: number, yPt: number, canvasBounds: Bounds): Position {
  return {
    x: ptToCmNumber(xPt - canvasBounds.minX),
    y: ptToCmNumber(canvasBounds.maxY - yPt)
  };
}

function ptToCmNumber(valuePt: number): number {
  return round2(valuePt * PT_TO_CM);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function formatTikzNum(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const rounded = round2(value);
  if (Object.is(rounded, -0)) {
    return "0";
  }

  return rounded.toString();
}

function geometryBounds(geometry: Geometry | undefined): Bounds | undefined {
  if (!geometry?.position || !geometry.size) {
    return undefined;
  }

  return {
    minX: geometry.position.x,
    minY: geometry.position.y,
    maxX: geometry.position.x + geometry.size.width,
    maxY: geometry.position.y + geometry.size.height
  };
}

function parsePathBounds(pathData: string): Bounds | undefined {
  const numbers = pathData.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
  if (numbers.length < 2) {
    return undefined;
  }

  const points: Position[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push({ x: numbers[i], y: numbers[i + 1] });
  }

  return pointsBounds(points);
}

function pointsBounds(points: Position[]): Bounds | undefined {
  if (points.length === 0) {
    return undefined;
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function inflateBounds(bounds: Bounds | undefined, padding: number): Bounds | undefined {
  if (!bounds) {
    return undefined;
  }

  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding
  };
}

function mergeBounds(current: Bounds | undefined, next: Bounds | undefined): Bounds | undefined {
  if (!next) {
    return current;
  }

  if (!current) {
    return { ...next };
  }

  return {
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY)
  };
}

function finalizeCanvasBounds(bounds: Bounds | undefined): Bounds {
  const fallback: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const chosen = bounds ?? fallback;

  const padded = {
    minX: chosen.minX - 8,
    minY: chosen.minY - 8,
    maxX: chosen.maxX + 8,
    maxY: chosen.maxY + 8
  };

  if (padded.maxX <= padded.minX || padded.maxY <= padded.minY) {
    return fallback;
  }

  return padded;
}

function rgbaToTikzColor(red?: number, green?: number, blue?: number): string {
  if (red === undefined || green === undefined || blue === undefined) {
    return "black";
  }

  const r = clamp(Math.round(red * 255), 0, 255);
  const g = clamp(Math.round(green * 255), 0, 255);
  const b = clamp(Math.round(blue * 255), 0, 255);
  return `{rgb,255:red,${r};green,${g};blue,${b}}`;
}

function cssColorToTikzColor(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const rgb = input.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgb) {
    const r = clamp(Number(rgb[1]), 0, 255);
    const g = clamp(Number(rgb[2]), 0, 255);
    const b = clamp(Number(rgb[3]), 0, 255);
    return `{rgb,255:red,${r};green,${g};blue,${b}}`;
  }

  const rgba = input.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d*\.?\d+)\s*\)$/i);
  if (rgba) {
    const r = clamp(Number(rgba[1]), 0, 255);
    const g = clamp(Number(rgba[2]), 0, 255);
    const b = clamp(Number(rgba[3]), 0, 255);
    return `{rgb,255:red,${r};green,${g};blue,${b}}`;
  }

  const hex = input.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `{rgb,255:red,${r};green,${g};blue,${b}}`;
  }

  if (input === "none") {
    return "none";
  }

  return "black";
}

function escapeLatex(value: string): string {
  return value
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("#", "\\#")
    .replaceAll("$", "\\$")
    .replaceAll("%", "\\%")
    .replaceAll("&", "\\&")
    .replaceAll("_", "\\_")
    .replaceAll("^", "\\textasciicircum{}")
    .replaceAll("~", "\\textasciitilde{}");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
