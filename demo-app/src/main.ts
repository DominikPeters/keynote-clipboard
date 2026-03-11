import { invoke } from "@tauri-apps/api/core";
import {
  onClipboardChange,
  startListening,
  stopListening
} from "tauri-plugin-clipboard-x-api";

import {
  KEYNOTE_CLIPBOARD_FORMAT,
  applyClipboardChange,
  convertPayload,
  type ClipboardState,
  type CustomClipboardPayload,
  type DualConversionOutcome
} from "./clipboardLogic";

type PreviewMode = "svg" | "tikz";

type TikzCompileResponse =
  | {
      status: "success";
      pdf_base64: string;
      log_tail: string;
    }
  | {
      status: "error";
      message: string;
      log_tail: string;
    };

const ui = {
  refreshBtn: document.querySelector<HTMLButtonElement>("#refresh-btn"),
  modeToggle: document.querySelector<HTMLElement>("#preview-mode-toggle"),
  modeSvgBtn: document.querySelector<HTMLButtonElement>("#mode-svg-btn"),
  modeTikzBtn: document.querySelector<HTMLButtonElement>("#mode-tikz-btn"),
  standardDump: document.querySelector<HTMLElement>("#standard-dump"),
  payloadMeta: document.querySelector<HTMLElement>("#payload-meta"),
  statsDump: document.querySelector<HTMLElement>("#stats-dump"),
  diagnosticsDump: document.querySelector<HTMLElement>("#diagnostics-dump"),
  payloadText: document.querySelector<HTMLTextAreaElement>("#payload-text"),
  payloadBase64: document.querySelector<HTMLTextAreaElement>("#payload-base64"),
  svgOutput: document.querySelector<HTMLTextAreaElement>("#svg-output"),
  tikzOutput: document.querySelector<HTMLTextAreaElement>("#tikz-output"),
  previewStage: document.querySelector<HTMLElement>("#preview-stage")
};

let unlistenClipboard: (() => void) | null = null;
let state: ClipboardState = { refreshCount: 0, lastUpdatedIso: new Date(0).toISOString() };
let previewMode: PreviewMode = "svg";
let pdflatexAvailable = false;
let latestConversion: DualConversionOutcome | null = null;
let latestPayload: CustomClipboardPayload | null = null;
let latestTikzCompileIssue: { message: string; logTail: string } | null = null;
let previewNonce = 0;
let currentPdfObjectUrl: string | null = null;

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

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function setPreviewMessage(message: string, details?: string): void {
  if (!ui.previewStage) {
    return;
  }

  ui.previewStage.classList.remove("preview-stage--pdf");
  ui.previewStage.classList.add("muted");
  if (!details) {
    ui.previewStage.innerHTML = "";
    ui.previewStage.textContent = message;
    return;
  }

  ui.previewStage.innerHTML = `<div class="preview-error"><p>${escapeHtml(
    message
  )}</p><pre>${escapeHtml(details)}</pre></div>`;
}

function clearConversionView(message: string): void {
  if (currentPdfObjectUrl) {
    URL.revokeObjectURL(currentPdfObjectUrl);
    currentPdfObjectUrl = null;
  }

  setPreviewMessage(message);

  if (ui.statsDump) {
    ui.statsDump.textContent = JSON.stringify({}, null, 2);
  }

  if (ui.diagnosticsDump) {
    ui.diagnosticsDump.textContent = JSON.stringify([], null, 2);
  }

  if (ui.svgOutput) {
    ui.svgOutput.value = "";
  }

  if (ui.tikzOutput) {
    ui.tikzOutput.value = "";
  }

  latestConversion = null;
  latestPayload = null;
  latestTikzCompileIssue = null;
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

function collectDiagnostics(conversion: DualConversionOutcome): unknown[] {
  const diagnostics: unknown[] = [];

  diagnostics.push(...conversion.svg.diagnostics);
  diagnostics.push(...conversion.tikz.diagnostics);

  if (!conversion.svg.ok) {
    diagnostics.push({
      code: "svg-conversion-error",
      message: conversion.svg.error,
      severity: "error"
    });
  }

  if (!conversion.tikz.ok) {
    diagnostics.push({
      code: "tikz-conversion-error",
      message: conversion.tikz.error,
      severity: "error"
    });
  }

  if (latestTikzCompileIssue) {
    diagnostics.push({
      code: "tikz-compile-error",
      message: latestTikzCompileIssue.message,
      severity: "error",
      logTail: latestTikzCompileIssue.logTail
    });
  }

  return diagnostics;
}

function renderInspectorData(conversion: DualConversionOutcome): void {
  if (ui.svgOutput) {
    ui.svgOutput.value = conversion.svg.output;
  }

  if (ui.tikzOutput) {
    ui.tikzOutput.value = conversion.tikz.output;
  }

  if (ui.statsDump) {
    ui.statsDump.textContent = JSON.stringify(
      {
        svg: conversion.svg.stats,
        tikz: conversion.tikz.stats
      },
      null,
      2
    );
  }

  if (ui.diagnosticsDump) {
    ui.diagnosticsDump.textContent = JSON.stringify(collectDiagnostics(conversion), null, 2);
  }
}

function updateModeButtons(): void {
  if (ui.modeToggle) {
    ui.modeToggle.hidden = !pdflatexAvailable;
  }

  if (ui.modeSvgBtn) {
    const active = previewMode === "svg";
    ui.modeSvgBtn.dataset.active = String(active);
    ui.modeSvgBtn.setAttribute("aria-pressed", String(active));
  }

  if (ui.modeTikzBtn) {
    const active = previewMode === "tikz";
    ui.modeTikzBtn.dataset.active = String(active);
    ui.modeTikzBtn.setAttribute("aria-pressed", String(active));
    ui.modeTikzBtn.disabled = !pdflatexAvailable;
  }
}

function renderSvgPreview(svg: string): void {
  if (!ui.previewStage) {
    return;
  }

  ui.previewStage.classList.remove("muted", "preview-stage--pdf");
  ui.previewStage.innerHTML = svg;
}

function renderPdfPreview(pdfBase64: string): void {
  if (!ui.previewStage) {
    return;
  }

  if (currentPdfObjectUrl) {
    URL.revokeObjectURL(currentPdfObjectUrl);
    currentPdfObjectUrl = null;
  }

  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pdfBlob = new Blob([bytes], { type: "application/pdf" });
  currentPdfObjectUrl = URL.createObjectURL(pdfBlob);

  ui.previewStage.classList.remove("muted");
  ui.previewStage.classList.add("preview-stage--pdf");
  ui.previewStage.innerHTML = `<iframe class="pdf-preview" src="${currentPdfObjectUrl}" title="TikZ PDF preview"></iframe>`;
}

async function renderPreview(conversion: DualConversionOutcome, payloadSize: number): Promise<void> {
  const runNonce = ++previewNonce;

  if (previewMode === "svg") {
    if (conversion.svg.ok) {
      renderSvgPreview(conversion.svg.output);
      setStatus(`Rendered SVG from Keynote clipboard payload (${payloadSize} bytes).`);
      return;
    }

    setPreviewMessage("Payload could not be converted to SVG.");
    setStatus(`SVG conversion failed: ${conversion.svg.error}`, true);
    return;
  }

  if (!pdflatexAvailable) {
    setPreviewMessage("TikZ preview is unavailable because pdflatex was not found.");
    setStatus("pdflatex unavailable. Showing SVG mode only.", true);
    return;
  }

  if (!conversion.tikz.ok) {
    setPreviewMessage("Payload could not be converted to TikZ.");
    setStatus(`TikZ conversion failed: ${conversion.tikz.error}`, true);
    return;
  }

  latestTikzCompileIssue = null;
  renderInspectorData(conversion);
  setPreviewMessage("Compiling TikZ with pdflatex...");

  const response = await invoke<TikzCompileResponse>("compile_tikz_to_pdf", {
    tikz: conversion.tikz.output
  });

  if (runNonce !== previewNonce) {
    return;
  }

  if (response.status === "success") {
    renderPdfPreview(response.pdf_base64);
    setStatus(`Rendered TikZ PDF from Keynote clipboard payload (${payloadSize} bytes).`);
    return;
  }

  latestTikzCompileIssue = {
    message: response.message,
    logTail: response.log_tail
  };
  renderInspectorData(conversion);
  setPreviewMessage(`TikZ compile failed`, `${response.message}\n\n${response.log_tail}`.trim());
  setStatus(`TikZ compile failed: ${response.message}`, true);
}

async function refreshClipboard(): Promise<void> {
  try {
    setStatus("Refreshing clipboard...");

    const now = new Date();
    state = applyClipboardChange(state, now);

    renderStandardClipboard({
      refreshedAt: state.lastUpdatedIso,
      refreshCount: state.refreshCount,
      keynoteFormat: KEYNOTE_CLIPBOARD_FORMAT,
      pdflatexAvailable,
      previewMode
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

    const conversion = convertPayload(payload);
    latestConversion = conversion;
    latestPayload = payload;
    latestTikzCompileIssue = null;

    renderInspectorData(conversion);
    await renderPreview(conversion, payload.size);
  } catch (error) {
    clearConversionView("Clipboard refresh failed.");
    renderPayload(null);
    setStatus(`Refresh failed: ${String(error)}`, true);
  }
}

async function detectPdflatexAvailability(): Promise<void> {
  try {
    pdflatexAvailable = await invoke<boolean>("is_pdflatex_available");
  } catch {
    pdflatexAvailable = false;
  }

  if (!pdflatexAvailable) {
    previewMode = "svg";
  }

  updateModeButtons();
}

function selectPreviewMode(mode: PreviewMode): void {
  if (mode === "tikz" && !pdflatexAvailable) {
    return;
  }

  previewMode = mode;
  updateModeButtons();

  if (latestConversion && latestPayload) {
    void renderPreview(latestConversion, latestPayload.size);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  ui.refreshBtn?.addEventListener("click", () => void refreshClipboard());
  ui.modeSvgBtn?.addEventListener("click", () => selectPreviewMode("svg"));
  ui.modeTikzBtn?.addEventListener("click", () => selectPreviewMode("tikz"));

  await detectPdflatexAvailability();

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
  if (currentPdfObjectUrl) {
    URL.revokeObjectURL(currentPdfObjectUrl);
    currentPdfObjectUrl = null;
  }

  if (unlistenClipboard) {
    unlistenClipboard();
  }
  await stopListening();
});
