# Keynote Clipboard SVG Demo

A Tauri v2 demo app that watches clipboard contents for:

- `com.apple.apps.content-language.canvas-object-1.0`

When present, it reads the payload, parses it with the local `keynote-clipboard` source, converts to SVG, and renders a preview along with diagnostics and raw payload data.

## Run (macOS)

```bash
cd demo-app
npm install
npm run tauri dev
```

## Notes

- Best-effort rendering is expected; diagnostics are shown in-app.
- The app is focused on Keynote clipboard payloads, not general clipboard authoring.
