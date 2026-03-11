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
  SvgOptions,
  SvgResult,
  SvgStats
} from "./types.js";

const DEFAULT_SVG_OPTIONS: Required<Pick<SvgOptions, "canvas" | "anchorMode" | "includeDiagnostics">> = {
  canvas: "auto-bounds",
  anchorMode: "center",
  includeDiagnostics: true
};

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PathPlacement {
  transform?: string;
  bounds?: Bounds;
}

interface SvgRenderContext {
  defs: string[];
  gradientIdCounter: number;
  filterIdCounter: number;
  clipIdCounter: number;
  markerIdCounter: number;
  markerCache: Map<string, string>;
}

export function toSvg(document: KeynoteClipboardDocument, options: SvgOptions = {}): SvgResult {
  const opts = {
    ...DEFAULT_SVG_OPTIONS,
    ...options
  };

  const diagnostics: Diagnostic[] = [];
  const stats: SvgStats = {
    renderedShapes: 0,
    renderedConnectionLines: 0,
    renderedTextNodes: 0,
    renderedImagePlaceholders: 0,
    skippedObjects: 0
  };

  const addDiagnostic = (diagnostic: Diagnostic): void => {
    diagnostics.push(diagnostic);
  };

  const contentParts: string[] = [];
  const defsParts: string[] = [];
  const context: SvgRenderContext = {
    defs: defsParts,
    gradientIdCounter: 0,
    filterIdCounter: 0,
    clipIdCounter: 0,
    markerIdCounter: 0,
    markerCache: new Map()
  };
  let aggregateBounds: Bounds | undefined;

  for (const shape of document.shapes) {
    const rendered = renderShape(shape, contentParts, context, addDiagnostic);
    if (rendered.bounds) {
      aggregateBounds = mergeBounds(aggregateBounds, rendered.bounds);
    }
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
    const rendered = renderConnectionLine(line, contentParts, addDiagnostic);
    if (rendered.bounds) {
      aggregateBounds = mergeBounds(aggregateBounds, rendered.bounds);
    }
    if (rendered.rendered) {
      stats.renderedConnectionLines += 1;
    } else {
      stats.skippedObjects += 1;
    }
  }

  for (const image of document.images) {
    const rendered = renderImagePlaceholder(image, contentParts, addDiagnostic);
    if (rendered.bounds) {
      aggregateBounds = mergeBounds(aggregateBounds, rendered.bounds);
    }
    if (rendered.rendered) {
      stats.renderedImagePlaceholders += 1;
    } else {
      stats.skippedObjects += 1;
    }
  }

  const canvasBounds = finalizeCanvasBounds(aggregateBounds);
  const width = canvasBounds.maxX - canvasBounds.minX;
  const height = canvasBounds.maxY - canvasBounds.minY;

  const prolog = `<?xml version="1.0" encoding="UTF-8"?>`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNum(width)}" height="${formatNum(height)}" viewBox="${formatNum(canvasBounds.minX)} ${formatNum(canvasBounds.minY)} ${formatNum(width)} ${formatNum(height)}">`;
  const background = options.background
    ? `<rect x="${formatNum(canvasBounds.minX)}" y="${formatNum(canvasBounds.minY)}" width="${formatNum(width)}" height="${formatNum(height)}" fill="${escapeXmlAttr(options.background)}" />`
    : "";
  const defs = defsParts.length > 0 ? `<defs>\n${defsParts.join("\n")}\n</defs>` : "";
  const close = `</svg>`;

  const svg = [prolog, open, defs, background, ...contentParts, close].filter(Boolean).join("\n");

  return {
    svg,
    diagnostics: opts.includeDiagnostics ? diagnostics : [],
    stats
  };
}

export function toSvgFromClipboard(
  input: string | unknown,
  parseOptions: ParseOptions = {},
  svgOptions: SvgOptions = {}
): SvgResult {
  const parseResult = parseKeynoteClipboard(input, parseOptions);
  const svgResult = toSvg(parseResult.document, svgOptions);

  return {
    svg: svgResult.svg,
    diagnostics: svgOptions.includeDiagnostics === false
      ? []
      : [...parseResult.diagnostics, ...svgResult.diagnostics],
    stats: svgResult.stats
  };
}

function renderShape(
  shape: ShapeObject,
  out: string[],
  context: SvgRenderContext,
  addDiagnostic: (diagnostic: Diagnostic) => void
): { renderedShape: boolean; renderedText: boolean; bounds?: Bounds } {
  let bounds: Bounds | undefined;
  let renderedShape = false;
  let renderedText = false;

  const fill = resolveShapeFill(shape, context);
  const filterId = resolveShapeShadowFilter(shape, context);
  const filterAttr = filterId ? ` filter="url(#${escapeXmlAttr(filterId)})"` : "";
  const stroke = toStroke(shape.stroke);

  if (shape.path?.bezierPath) {
    const pathBounds = parsePathBounds(shape.path.bezierPath);
    const placement = computePathPlacement(shape.geometry, shape.path.space, pathBounds);
    const transformAttr = placement.transform ? ` transform="${placement.transform}"` : "";
    const strokeDashAttr = stroke.dasharray ? ` stroke-dasharray="${escapeXmlAttr(stroke.dasharray)}"` : "";
    const strokeCapAttr = stroke.linecap ? ` stroke-linecap="${escapeXmlAttr(stroke.linecap)}"` : "";
    const markers = resolveShapeMarkers(shape, stroke, context);
    const markerStartAttr = markers.startId ? ` marker-start="url(#${escapeXmlAttr(markers.startId)})"` : "";
    const markerEndAttr = markers.endId ? ` marker-end="url(#${escapeXmlAttr(markers.endId)})"` : "";
    out.push(
      `<path d="${escapeXmlAttr(shape.path.bezierPath)}"${transformAttr}${filterAttr}${markerStartAttr}${markerEndAttr} fill="${escapeXmlAttr(fill)}" stroke="${escapeXmlAttr(stroke.color)}" stroke-width="${formatNum(stroke.width)}"${strokeDashAttr}${strokeCapAttr} />`
    );

    renderedShape = true;
    bounds = mergeBounds(bounds, placement.bounds ?? pathBounds);
  } else {
    const rectBounds = geometryBounds(shape.geometry);
    if (rectBounds) {
      const strokeDashAttr = stroke.dasharray ? ` stroke-dasharray="${escapeXmlAttr(stroke.dasharray)}"` : "";
      const strokeCapAttr = stroke.linecap ? ` stroke-linecap="${escapeXmlAttr(stroke.linecap)}"` : "";
      out.push(
        `<rect x="${formatNum(rectBounds.minX)}" y="${formatNum(rectBounds.minY)}" width="${formatNum(rectBounds.maxX - rectBounds.minX)}" height="${formatNum(rectBounds.maxY - rectBounds.minY)}"${filterAttr} fill="${escapeXmlAttr(fill)}" stroke="${escapeXmlAttr(stroke.color)}" stroke-width="${formatNum(stroke.width)}"${strokeDashAttr}${strokeCapAttr} />`
      );
      bounds = mergeBounds(bounds, rectBounds);
      renderedShape = true;

      addDiagnostic({
        code: "svg-shape-rect-fallback",
        severity: "warning",
        message: "Shape path missing; rendered rectangle fallback from geometry",
        sourceIndex: shape.sourceIndex
      });
    } else {
      addDiagnostic({
        code: "svg-shape-skipped",
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
    const textPos = textAnchor(shape, bounds, textStyle.textAnchor);
    if (textPos) {
      const textClipBounds = geometryBounds(shape.geometry) ?? bounds;
      const clipId = registerRectClip(textClipBounds, context);
      const clipAttr = clipId ? ` clip-path="url(#${escapeXmlAttr(clipId)})"` : "";
      const decorationAttr = textStyle.textDecoration
        ? ` text-decoration="${escapeXmlAttr(textStyle.textDecoration)}"`
        : "";
      out.push(
        `<text x="${formatNum(textPos.x)}" y="${formatNum(textPos.y)}"${clipAttr} fill="${escapeXmlAttr(textStyle.fill)}" font-family="${escapeXmlAttr(textStyle.fontFamily)}" font-size="${formatNum(textStyle.fontSize)}" text-anchor="${escapeXmlAttr(textStyle.textAnchor)}"${decorationAttr} dominant-baseline="${escapeXmlAttr(textPos.dominantBaseline)}">${escapeXmlText(text)}</text>`
      );
      const approx = approximateTextBounds(textPos, textStyle.fontSize, text, textStyle.textAnchor, textPos.dominantBaseline);
      bounds = mergeBounds(bounds, approx);
      renderedText = true;
    } else {
      addDiagnostic({
        code: "svg-text-skipped",
        severity: "warning",
        message: "Text skipped because no placement geometry was available",
        sourceIndex: shape.sourceIndex
      });
    }
  }

  return { renderedShape, renderedText, bounds };
}

function renderConnectionLine(
  line: ConnectionLineObject,
  out: string[],
  addDiagnostic: (diagnostic: Diagnostic) => void
): { rendered: boolean; bounds?: Bounds } {
  const head = line.head?.endPoint;
  const tail = line.tail?.endPoint;
  if (!head || !tail) {
    addDiagnostic({
      code: "svg-connection-line-skipped",
      severity: "warning",
      message: "Connection line skipped because head/tail endpoints were missing",
      sourceIndex: line.sourceIndex
    });
    return { rendered: false };
  }

  const stroke = toStroke(line.stroke);
  let path = `M ${formatNum(head.x)} ${formatNum(head.y)} L ${formatNum(tail.x)} ${formatNum(tail.y)}`;

  if (line.lineType?.kind === "corner" && line.lineType.point) {
    const corner = line.lineType.point;
    path = `M ${formatNum(head.x)} ${formatNum(head.y)} L ${formatNum(corner.x)} ${formatNum(corner.y)} L ${formatNum(tail.x)} ${formatNum(tail.y)}`;
  } else if (line.lineType?.kind === "curved" && line.lineType.point) {
    const curve = line.lineType.point;
    path = `M ${formatNum(head.x)} ${formatNum(head.y)} Q ${formatNum(curve.x)} ${formatNum(curve.y)} ${formatNum(tail.x)} ${formatNum(tail.y)}`;
  }

  const strokeDashAttr = stroke.dasharray ? ` stroke-dasharray="${escapeXmlAttr(stroke.dasharray)}"` : "";
  const strokeCapAttr = stroke.linecap ? ` stroke-linecap="${escapeXmlAttr(stroke.linecap)}"` : "";
  out.push(
    `<path d="${escapeXmlAttr(path)}" fill="none" stroke="${escapeXmlAttr(stroke.color)}" stroke-width="${formatNum(stroke.width)}"${strokeDashAttr}${strokeCapAttr} />`
  );

  let bounds = pointsBounds([head, tail, line.lineType?.point].filter((v): v is Position => Boolean(v)));
  bounds = inflateBounds(bounds, stroke.width / 2);
  return { rendered: true, bounds };
}

function renderImagePlaceholder(
  image: KeynoteClipboardDocument["images"][number],
  out: string[],
  addDiagnostic: (diagnostic: Diagnostic) => void
): { rendered: boolean; bounds?: Bounds } {
  const bounds = geometryBounds(image.geometry);
  if (!bounds) {
    addDiagnostic({
      code: "svg-image-skipped",
      severity: "warning",
      message: "Image placeholder skipped because geometry was missing",
      sourceIndex: image.sourceIndex
    });
    return { rendered: false };
  }

  const label = image.resource?.indirect?.filename ?? image.resource?.indirect?.identifier ?? "image";
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const cx = bounds.minX + width / 2;
  const cy = bounds.minY + height / 2;

  out.push(
    `<rect x="${formatNum(bounds.minX)}" y="${formatNum(bounds.minY)}" width="${formatNum(width)}" height="${formatNum(height)}" fill="#f5f5f5" stroke="#666" stroke-width="1" stroke-dasharray="6 4" />`
  );
  out.push(
    `<text x="${formatNum(cx)}" y="${formatNum(cy)}" fill="#444" font-family="sans-serif" font-size="12" text-anchor="middle" dominant-baseline="middle">${escapeXmlText(label)}</text>`
  );

  return { rendered: true, bounds };
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
  textDecoration?: string;
} {
  const textStyle = text.style;
  const hasStyleFont = typeof textStyle?.fontFamily === "string" || typeof textStyle?.fontSize === "number";
  let fontFamily = textStyle?.fontFamily ?? "sans-serif";
  let fontSize = textStyle?.fontSize ?? 16;
  let fill = textStyle?.fontColor ?? (toSolidFill(shape) !== "none" ? toSolidFill(shape) : "#111");
  let textAnchor: "start" | "middle" | "end" = "start";
  if (textStyle?.paragraphAlignment === "start") {
    textAnchor = "start";
  } else if (textStyle?.paragraphAlignment === "end") {
    textAnchor = "end";
  } else if (textStyle?.paragraphAlignment === "center") {
    textAnchor = "middle";
  }
  const decoration: string[] = [];
  if (textStyle?.underline) {
    decoration.push("underline");
  }
  if (textStyle?.strikethrough) {
    decoration.push("line-through");
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
      code: "svg-text-font-fallback",
      severity: "warning",
      message: "Could not decode NSFont; using fallback text font",
      sourceIndex,
      path: "text.attributed_string.1.NSFont"
    });
  }

  return {
    fontFamily,
    fontSize,
    fill,
    textAnchor,
    textDecoration: decoration.length > 0 ? decoration.join(" ") : undefined
  };
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
        transform: `matrix(${formatNum(scaleX)} 0 0 ${formatNum(scaleY)} ${formatNum(tx)} ${formatNum(ty)})`,
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

  const transform = `matrix(${formatNum(scaleX)} 0 0 ${formatNum(scaleY)} ${formatNum(tx)} ${formatNum(ty)})`;
  return { transform, bounds };
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
): (Position & { dominantBaseline: "middle" | "text-before-edge" | "text-after-edge" }) | undefined {
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

function approximateTextBounds(
  anchor: Position & { dominantBaseline?: "middle" | "text-before-edge" | "text-after-edge" },
  fontSize: number,
  content: string,
  textAnchor: "start" | "middle" | "end",
  dominantBaseline: "middle" | "text-before-edge" | "text-after-edge"
): Bounds {
  const width = Math.max(fontSize * content.length * 0.6, fontSize);
  const height = fontSize * 1.2;

  let minX = anchor.x - width / 2;
  let maxX = anchor.x + width / 2;
  if (textAnchor === "start") {
    minX = anchor.x;
    maxX = anchor.x + width;
  } else if (textAnchor === "end") {
    minX = anchor.x - width;
    maxX = anchor.x;
  }

  let minY = anchor.y - height / 2;
  let maxY = anchor.y + height / 2;
  if (dominantBaseline === "text-before-edge") {
    minY = anchor.y;
    maxY = anchor.y + height;
  } else if (dominantBaseline === "text-after-edge") {
    minY = anchor.y - height;
    maxY = anchor.y;
  }

  return {
    minX,
    minY,
    maxX,
    maxY
  };
}

function registerRectClip(bounds: Bounds | undefined, context: SvgRenderContext): string | undefined {
  if (!bounds) {
    return undefined;
  }

  const id = `kc-clip-${context.clipIdCounter++}`;
  context.defs.push(
    `<clipPath id="${id}"><rect x="${formatNum(bounds.minX)}" y="${formatNum(bounds.minY)}" width="${formatNum(bounds.maxX - bounds.minX)}" height="${formatNum(bounds.maxY - bounds.minY)}" /></clipPath>`
  );
  return id;
}

function resolveShapeMarkers(
  shape: ShapeObject,
  stroke: { color: string; width: number },
  context: SvgRenderContext
): { startId?: string; endId?: string } {
  if (stroke.color === "none" || stroke.width <= 0) {
    return {};
  }

  const startStyle = normalizeMarkerStyle(shape.tail);
  const endStyle = normalizeMarkerStyle(shape.head);

  return {
    startId: startStyle ? registerMarker(startStyle, stroke.color, context) : undefined,
    endId: endStyle ? registerMarker(endStyle, stroke.color, context) : undefined
  };
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

function registerMarker(style: string, color: string, context: SvgRenderContext): string | undefined {
  const key = `${style}|${color}`;
  const cached = context.markerCache.get(key);
  if (cached) {
    return cached;
  }

  const markerId = `kc-marker-${context.markerIdCounter++}`;
  const spec = markerShapeMarkup(style, color);
  if (!spec) {
    return undefined;
  }

  context.defs.push(
    `<marker id="${markerId}" markerWidth="${formatNum(spec.size)}" markerHeight="${formatNum(spec.size)}" viewBox="0 0 10 10" refX="${formatNum(spec.refX)}" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">${spec.markup}</marker>`
  );
  context.markerCache.set(key, markerId);
  return markerId;
}

function markerShapeMarkup(style: string, color: string): { markup: string; size: number; refX: number } | undefined {
  const stroke = `stroke="${escapeXmlAttr(color)}" stroke-width="1.2"`;
  const fill = `fill="${escapeXmlAttr(color)}"`;

  switch (style) {
    case "simple_arrow":
      return { markup: `<path d="M 1.6 1 L 9.4 5 L 1.6 9 Z" ${fill} />`, size: 10.5, refX: 10.4 };
    case "open_arrow":
      return {
        markup: `<path d="M 1.8 1.3 L 9.2 5 L 1.8 8.7" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round" />`,
        size: 10.5,
        refX: 10.6
      };
    case "filled_arrow":
      return {
        markup: `<path d="M 0.8 0.8 L 9.4 5 L 0.8 9.2 L 3.7 5 Z" ${fill} />`,
        size: 11,
        refX: 10.9
      };
    case "inverted_arrow":
      return { markup: `<path d="M 9.2 1.2 L 1.8 5 L 9.2 8.8 Z" ${fill} />`, size: 9.5, refX: 10.5 };
    case "filled_circle":
      return { markup: `<circle cx="5" cy="5" r="3.3" ${fill} />`, size: 9.5, refX: 10.6 };
    case "open_circle":
      return { markup: `<circle cx="5" cy="5" r="3.3" fill="none" ${stroke} />`, size: 9.5, refX: 10.8 };
    case "filled_square":
      return { markup: `<rect x="1.4" y="1.4" width="7.2" height="7.2" ${fill} />`, size: 9.5, refX: 10.6 };
    case "open_square":
      return { markup: `<rect x="1.4" y="1.4" width="7.2" height="7.2" fill="none" ${stroke} />`, size: 9.5, refX: 10.8 };
    case "filled_diamond":
      return { markup: `<path d="M 5 0.7 L 9.3 5 L 5 9.3 L 0.7 5 Z" ${fill} />`, size: 9.5, refX: 10.6 };
    case "line":
      return { markup: `<path d="M 9.6 1.1 L 9.6 8.9" ${stroke} stroke-linecap="square" />`, size: 9.5, refX: 10.8 };
    default:
      return undefined;
  }
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

function toSolidFill(shape: ShapeObject): string {
  const rgba = shape.fill?.color?.rgba;
  if (!rgba) {
    return "none";
  }
  return rgbaToCss(rgba.red, rgba.green, rgba.blue, rgba.alpha);
}

function resolveShapeFill(shape: ShapeObject, context: SvgRenderContext): string {
  const gradient = shape.fill?.gradient;
  if (gradient?.flavor?.kind === "linear" && gradient.stops && gradient.stops.length > 0) {
    const gradientId = registerLinearGradient(gradient, context);
    if (gradientId) {
      return `url(#${gradientId})`;
    }
  }

  return toSolidFill(shape);
}

function registerLinearGradient(
  gradient: NonNullable<ShapeObject["fill"]>["gradient"],
  context: SvgRenderContext
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

  const angle = gradient.flavor?.linearAngle ?? 0;
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = -Math.sin(radians);
  const x1 = clamp01(0.5 - dx / 2);
  const y1 = clamp01(0.5 - dy / 2);
  const x2 = clamp01(0.5 + dx / 2);
  const y2 = clamp01(0.5 + dy / 2);

  const id = `kc-grad-${context.gradientIdCounter++}`;
  const stopTags = sortedStops.map((stop) => {
    const offset = clamp01(stop.fraction ?? 0);
    const rgba = stop.color?.rgba;
    const baseOpacity = rgba?.alpha ?? 1;
    const opacity = clamp((gradient.opacity ?? 1) * baseOpacity, 0, 1);
    const stopColor = rgbaToCss(rgba?.red, rgba?.green, rgba?.blue, 1);
    return `<stop offset="${formatNum(offset * 100)}%" stop-color="${escapeXmlAttr(stopColor)}" stop-opacity="${formatNum(opacity)}" />`;
  });

  context.defs.push(
    `<linearGradient id="${id}" x1="${formatNum(x1)}" y1="${formatNum(y1)}" x2="${formatNum(x2)}" y2="${formatNum(y2)}">${stopTags.join("")}</linearGradient>`
  );

  return id;
}

function resolveShapeShadowFilter(shape: ShapeObject, context: SvgRenderContext): string | undefined {
  const selected = shape.shadow?.dropShadow ?? shape.shadow?.contactShadow;
  if (!selected) {
    return undefined;
  }

  const angle = selected.angle ?? 0;
  const offset = selected.offset ?? 0;
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians) * offset;
  const dy = -Math.sin(radians) * offset + (selected.height ?? 0);
  const stdDeviation = Math.max((selected.radius ?? 0) / 2, 0);
  const rgba = selected.color?.rgba;
  const floodColor = rgbaToCss(rgba?.red, rgba?.green, rgba?.blue, 1);
  const floodOpacity = clamp((selected.opacity ?? 1) * (rgba?.alpha ?? 1), 0, 1);

  const id = `kc-filter-${context.filterIdCounter++}`;
  context.defs.push(
    `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${formatNum(dx)}" dy="${formatNum(dy)}" stdDeviation="${formatNum(stdDeviation)}" flood-color="${escapeXmlAttr(floodColor)}" flood-opacity="${formatNum(floodOpacity)}" /></filter>`
  );
  return id;
}

function toStroke(stroke: Stroke): { color: string; width: number; dasharray?: string; linecap?: "round" } {
  if (stroke.kind === "line") {
    const color = rgbaToCss(
      stroke.line?.color?.rgba?.red,
      stroke.line?.color?.rgba?.green,
      stroke.line?.color?.rgba?.blue,
      stroke.line?.color?.rgba?.alpha
    );
    const width = stroke.line?.width ?? 1;
    const pattern = stroke.line?.pattern;
    const mapped = mapDashPattern(pattern, width);

    return {
      color,
      width,
      dasharray: mapped?.dasharray,
      linecap: mapped?.roundCaps ? "round" : undefined
    };
  }

  if (stroke.kind === "empty") {
    return { color: "none", width: 0, dasharray: undefined, linecap: undefined };
  }

  return { color: "#000", width: 1, dasharray: undefined, linecap: undefined };
}

function mapDashPattern(
  pattern: string | undefined,
  width: number
): { dasharray?: string; roundCaps?: boolean } | undefined {
  if (!pattern || pattern === "solid") {
    return undefined;
  }

  const w = Math.max(width, 0.1);

  switch (pattern) {
    case "short_dash":
      return { dasharray: `${formatNum(w * 2)} ${formatNum(w * 2)}` };
    case "medium_dash":
      return { dasharray: `${formatNum(w * 4)} ${formatNum(w * 2.5)}` };
    case "long_dash":
      return { dasharray: `${formatNum(w * 7)} ${formatNum(w * 3)}` };
    case "round_dash":
      return { dasharray: `${formatNum(w * 0.1)} ${formatNum(w * 2.5)}`, roundCaps: true };
    default:
      return undefined;
  }
}

function rgbaToCss(red?: number, green?: number, blue?: number, alpha?: number): string {
  if (red === undefined || green === undefined || blue === undefined) {
    return "#000";
  }

  const r = clamp(Math.round(red * 255), 0, 255);
  const g = clamp(Math.round(green * 255), 0, 255);
  const b = clamp(Math.round(blue * 255), 0, 255);
  const a = alpha === undefined ? 1 : clamp(alpha, 0, 1);

  if (a === 1) {
    return `rgb(${r},${g},${b})`;
  }

  return `rgba(${r},${g},${b},${formatNum(a)})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Number(value.toFixed(4)).toString();
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
