# keynote-clipboard

<img src="https://raw.githubusercontent.com/DominikPeters/keynote-clipboard/refs/heads/master/demo-app/src/assets/keynote-clipboard-logo.svg" alt="keynote-clipboard logo" width="180" align="right" />
`keynote-clipboard` parses Keynote clipboard payloads of type `com.apple.apps.content-language.canvas-object-1.0` into a normalized JavaScript/TypeScript model and can convert it to SVG or TikZ.

It is useful when you want to:

- inspect what Keynote copied to the clipboard
- turn copied diagrams into structured JSON
- render clipboard content as SVG
- convert simple Keynote graphics into TikZ/LaTeX

The package includes both a library API and a CLI, as well as a macOS demo app.

## What It Does

Input:
- JSON payloads exported from the Keynote clipboard format
- a single object, an array of objects, or the numeric-key object table Keynote commonly produces

Output:
- normalized shapes, connection lines, images, and unknown objects
- decoded text styling metadata, including archived Foundation values when available
- diagnostics for unsupported or partially parsed fields
- optional SVG or TikZ rendering from the normalized document

## Supported Today

Parsed object types:

- `com.apple.apps.content-language.shape`
- `com.apple.apps.content-language.connection-line`
- `com.apple.apps.content-language.image`

Parsing support includes:

- geometry, fills, strokes, gradients, shadows, paths, and layout properties
- text extraction plus decoding of archived values such as `NSFont`, `NSColor`, and `NSParagraphStyle`
- lenient parsing that preserves unknown objects instead of failing hard
- connection-line anchor resolution back to shape identifiers

Rendering support:

- SVG for shapes, connection lines, basic text, gradients, shadows, markers, and image placeholders
- TikZ for shapes, connection lines, basic text, gradients, shadows, markers, and image placeholders
- standalone LaTeX output for TikZ when needed

## Limitations

This project currently aims for stable, useful output rather than pixel-perfect Keynote fidelity.

Current gaps include:

- rich text layout is simplified
- images are rendered as placeholders, not embedded assets
- unsupported objects are kept in the parsed document but may not render
- some complex Keynote-specific effects may fall back to simpler shapes

## Install

```bash
npm install keynote-clipboard
```

Requirements:

- Node.js `18+`

## Quick Start

### Library

```ts
import {
  parseKeynoteClipboardFile,
  toSvg,
  toTikz
} from "keynote-clipboard";

const parsed = await parseKeynoteClipboardFile("./complex-keynote-clipboard.json");

console.log(parsed.stats);
console.log(parsed.document.shapes.length);
console.log(parsed.diagnostics);

const svg = toSvg(parsed.document);
console.log(svg.svg);

const tikz = toTikz(parsed.document, { standalone: true });
console.log(tikz.tikz);
```

If you already have the clipboard payload as a JSON string:

```ts
import {
  parseKeynoteClipboard,
  toSvgFromClipboard,
  toTikzFromClipboard
} from "keynote-clipboard";

const parsed = parseKeynoteClipboard(rawClipboardJsonString);
const svg = toSvgFromClipboard(rawClipboardJsonString);
const tikz = toTikzFromClipboard(rawClipboardJsonString, {}, { standalone: true });
```

### CLI

Inspect a payload:

```bash
npx keynote-clipboard inspect complex-keynote-clipboard.json --pretty --diagnostics
```

Render SVG:

```bash
npx keynote-clipboard svg complex-keynote-clipboard.json --out slide.svg
```

Render TikZ:

```bash
npx keynote-clipboard tikz complex-keynote-clipboard.json --out slide.tikz
```

Emit a standalone LaTeX document:

```bash
npx keynote-clipboard tikz complex-keynote-clipboard.json --standalone --out slide.tex
```

Available commands:

- `inspect <file>`: print the parsed document and stats as JSON
- `svg <file>`: write SVG to stdout or `--out`
- `tikz <file>`: write TikZ to stdout or `--out`

Available flags:

- `--pretty`: pretty-print JSON output
- `--diagnostics`: include diagnostics
- `--standalone`: emit a standalone LaTeX document for `tikz`
- `--out <path>`: write SVG or TikZ to a file

Note:
- for `svg` and `tikz`, rendered content goes to stdout or `--out`
- when `--diagnostics` is used with `svg` or `tikz`, diagnostics are written to stderr as JSON

## API

Main exports:

- `parseKeynoteClipboard(input, options?)`
- `parseKeynoteClipboardFile(filePath, options?)`
- `normalizeTopLevelEntries(input, addDiagnostic?)`
- `decodeArchivedValue(base64)`
- `isLikelyBplistBase64(value)`
- `sanitizeForJson(value)`
- `toSvg(document, options?)`
- `toSvgFromClipboard(input, parseOptions?, svgOptions?)`
- `toTikz(document, options?)`
- `toTikzFromClipboard(input, parseOptions?, tikzOptions?)`

Common parse options:

- `mode: "lenient"`
- `decodeArchives: true`
- `collectDiagnostics: true`

The parse result contains:

- `document`: normalized `KeynoteClipboardDocument`
- `diagnostics`: warnings and parse issues
- `stats`: counts for parsed objects and diagnostics

## Development

```bash
npm run typecheck
npm run test
npm run build
```

## Demo App

A local Tauri demo app lives in [`demo-app/`](/Users/dominik/GitHub/keynote-clipboard/demo-app) and previews clipboard payloads using the local source build.

```bash
cd demo-app
npm install
npm run tauri dev
```
