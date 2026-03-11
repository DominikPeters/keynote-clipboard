import { invoke } from "@tauri-apps/api/core";
import {
  onClipboardChange,
  startListening,
  stopListening
} from "tauri-plugin-clipboard-x-api";

import {
  KEYNOTE_CLIPBOARD_FORMAT,
  applyClipboardChange,
  convertPayloadToSvg,
  type ClipboardState,
  type CustomClipboardPayload
} from "./clipboardLogic";

const ui = {
  refreshBtn: document.querySelector<HTMLButtonElement>("#refresh-btn"),
  standardDump: document.querySelector<HTMLElement>("#standard-dump"),
  payloadMeta: document.querySelector<HTMLElement>("#payload-meta"),
  statsDump: document.querySelector<HTMLElement>("#stats-dump"),
  diagnosticsDump: document.querySelector<HTMLElement>("#diagnostics-dump"),
  payloadText: document.querySelector<HTMLTextAreaElement>("#payload-text"),
  payloadBase64: document.querySelector<HTMLTextAreaElement>("#payload-base64"),
  svgPreview: document.querySelector<HTMLElement>("#svg-preview")
};

let unlistenClipboard: (() => void) | null = null;
let state: ClipboardState = { refreshCount: 0, lastUpdatedIso: new Date(0).toISOString() };

function setStatus(message: string, isError = false): void {
  if (ui.refreshBtn) {
    ui.refreshBtn.title = message;
    ui.refreshBtn.dataset.variant = isError ? "error" : "ok";
  }
}

function renderStandardClipboard(data: unknown): void {
  if (ui.standardDump) {
    ui.standardDump.textContent = JSON.stringify(data, null, 2);
  }
}

function clearConversionView(message: string): void {
  if (ui.svgPreview) {
    ui.svgPreview.innerHTML = "";
    ui.svgPreview.textContent = message;
    ui.svgPreview.classList.add("muted");
  }

  if (ui.statsDump) {
    ui.statsDump.textContent = JSON.stringify({}, null, 2);
  }

  if (ui.diagnosticsDump) {
    ui.diagnosticsDump.textContent = JSON.stringify([], null, 2);
  }
}

function renderPayload(payload: CustomClipboardPayload | null): void {
  if (!payload) {
    if (ui.payloadMeta) {
      ui.payloadMeta.textContent = "";
    }
    if (ui.payloadText) {
      ui.payloadText.value = "";
    }
    if (ui.payloadBase64) {
      ui.payloadBase64.value = "";
    }
    return;
  }

  if (ui.payloadMeta) {
    ui.payloadMeta.textContent = `${payload.format} (${payload.size} bytes)`;
  }
  if (ui.payloadText) {
    ui.payloadText.value = payload.utf8 ?? "";
  }
  if (ui.payloadBase64) {
    ui.payloadBase64.value = payload.base64;
  }
}

async function refreshClipboard(): Promise<void> {
  try {
    setStatus("Refreshing clipboard...");

    const now = new Date();
    state = applyClipboardChange(state, now);

    renderStandardClipboard({
      refreshedAt: state.lastUpdatedIso,
      refreshCount: state.refreshCount,
      keynoteFormat: KEYNOTE_CLIPBOARD_FORMAT
    });

    let payload: CustomClipboardPayload | null = null;
    try {
      payload = await invoke<CustomClipboardPayload>("read_custom_clipboard_format", {
        format: KEYNOTE_CLIPBOARD_FORMAT
      });
    } catch {
      payload = null;
    }

    if (!payload || payload.format !== KEYNOTE_CLIPBOARD_FORMAT) {
      renderPayload(null);
      if (ui.payloadMeta) {
        ui.payloadMeta.textContent = "Keynote format not found on clipboard.";
      }
      clearConversionView("Keynote content is not present on the clipboard.");
      setStatus("Clipboard checked. Keynote format not present.");
      return;
    }

    renderPayload(payload);

    const conversion = convertPayloadToSvg(payload);
    if (!conversion.ok) {
      clearConversionView("Payload could not be converted to SVG.");
      if (ui.diagnosticsDump) {
        ui.diagnosticsDump.textContent = JSON.stringify(
          [{ code: "conversion-error", message: conversion.error, severity: "error" }],
          null,
          2
        );
      }
      setStatus(`Conversion failed: ${conversion.error}`, true);
      return;
    }

    if (ui.svgPreview) {
      ui.svgPreview.classList.remove("muted");
      ui.svgPreview.innerHTML = conversion.svg;
    }

    if (ui.statsDump) {
      ui.statsDump.textContent = JSON.stringify(conversion.stats, null, 2);
    }

    if (ui.diagnosticsDump) {
      ui.diagnosticsDump.textContent = JSON.stringify(conversion.diagnostics, null, 2);
    }

    setStatus(`Rendered SVG from Keynote clipboard payload (${payload.size} bytes).`);
  } catch (error) {
    clearConversionView("Clipboard refresh failed.");
    renderPayload(null);
    setStatus(`Refresh failed: ${String(error)}`, true);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  ui.refreshBtn?.addEventListener("click", () => void refreshClipboard());

  try {
    await startListening();
    unlistenClipboard = await onClipboardChange(() => {
      void refreshClipboard();
    });
  } catch (error) {
    setStatus(`Clipboard listening failed: ${String(error)}`, true);
  }

  await refreshClipboard();
});

window.addEventListener("beforeunload", async () => {
  if (unlistenClipboard) {
    unlistenClipboard();
  }
  await stopListening();
});
