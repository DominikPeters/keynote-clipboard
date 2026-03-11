# keynote-clipboard

Parser for Keynote clipboard payloads (`com.apple.apps.content-language.canvas-object-1.0`).

## What it parses today

- `com.apple.apps.content-language.shape`
- `com.apple.apps.content-language.connection-line`
- `com.apple.apps.content-language.image`
- Text attribute archives (`NSFont`, `NSColor`, `NSParagraphStyle`) via `@skgrush/bplist-and-nskeyedunarchiver`

The parser is lenient: unknown fields are preserved and surfaced as diagnostics.

## SVG conversion (v1)

- Supports shapes, connection lines, basic text, and image placeholders.
- Uses auto-bounds canvas sizing and center-anchor geometry placement.
- Prioritizes stable, useful output over pixel-perfect Keynote fidelity.

## Install

```bash
npm install keynote-clipboard
```

## Quick start (library)

```ts
import { parseKeynoteClipboard, parseKeynoteClipboardFile } from "keynote-clipboard";
import { toSvg, toSvgFromClipboard } from "keynote-clipboard";

const resultFromJson = parseKeynoteClipboard(rawClipboardJsonString);
const resultFromFile = await parseKeynoteClipboardFile("./complex-keynote-clipboard.json");

console.log(resultFromFile.stats);
console.log(resultFromFile.document.shapes.length);

const svg = toSvg(resultFromFile.document);
console.log(svg.svg);

const directSvg = toSvgFromClipboard(rawClipboardJsonString);
console.log(directSvg.stats);
```

## API

- `parseKeynoteClipboard(input, options?)`
- `parseKeynoteClipboardFile(filePath, options?)`
- `decodeArchivedValue(base64)`
- `toSvg(document, options?)`
- `toSvgFromClipboard(input, parseOptions?, svgOptions?)`

Default parse options:

- `mode: "lenient"`
- `decodeArchives: true`
- `collectDiagnostics: true`

## CLI

```bash
keynote-clipboard inspect complex-keynote-clipboard.json --pretty --diagnostics
keynote-clipboard svg complex-keynote-clipboard.json --out slide.svg
```

Flags:

- `--pretty`: pretty-print JSON output
- `--diagnostics`: include diagnostics in output
- `--out <path>`: write SVG output to a file (svg command)

## Development

```bash
npm run typecheck
npm run test
npm run build
```

## Demo App

A local Tauri demo app is available at:

- `demo-app/`

It listens for `com.apple.apps.content-language.canvas-object-1.0` on the clipboard and renders SVG preview + diagnostics from the local source build.

```bash
cd demo-app
npm install
npm run tauri dev
```

## Roadmap

Current SVG output is best-effort. Rich text fidelity, embedded image resources, and TikZ output are planned next on top of the same normalized model.
