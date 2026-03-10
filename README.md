# keynote-clipboard

Parser for Keynote clipboard payloads (`com.apple.apps.content-language.canvas-object-1.0`).

## What it parses today

- `com.apple.apps.content-language.shape`
- `com.apple.apps.content-language.connection-line`
- `com.apple.apps.content-language.image`
- Text attribute archives (`NSFont`, `NSColor`, `NSParagraphStyle`) via `@skgrush/bplist-and-nskeyedunarchiver`

The parser is lenient: unknown fields are preserved and surfaced as diagnostics.

## Install

```bash
npm install keynote-clipboard
```

## Quick start (library)

```ts
import { parseKeynoteClipboard, parseKeynoteClipboardFile } from "keynote-clipboard";

const resultFromJson = parseKeynoteClipboard(rawClipboardJsonString);
const resultFromFile = await parseKeynoteClipboardFile("./complex-keynote-clipboard.json");

console.log(resultFromFile.stats);
console.log(resultFromFile.document.shapes.length);
```

## API

- `parseKeynoteClipboard(input, options?)`
- `parseKeynoteClipboardFile(filePath, options?)`
- `decodeArchivedValue(base64)`

Default parse options:

- `mode: "lenient"`
- `decodeArchives: true`
- `collectDiagnostics: true`

## CLI

```bash
keynote-clipboard inspect complex-keynote-clipboard.json --pretty --diagnostics
```

Flags:

- `--pretty`: pretty-print JSON output
- `--diagnostics`: include diagnostics in output

## Development

```bash
npm run typecheck
npm run test
npm run build
```

## Roadmap

This package currently focuses on parsing and normalization. SVG and TikZ conversion are planned as next-stage modules built on the normalized document model.
