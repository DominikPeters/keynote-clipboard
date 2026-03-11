import { Reader, Uid } from "@skgrush/bplist-and-nskeyedunarchiver/bplist";
import { LogLevel, buildLeveledLogger } from "@skgrush/bplist-and-nskeyedunarchiver/shared";

import type { DecodedArchiveResult } from "./types.js";

export function isLikelyBplistBase64(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("YnBsaXN0");
}

export function decodeArchivedValue(base64: string): DecodedArchiveResult {
  if (!isLikelyBplistBase64(base64)) {
    return {
      success: false,
      rawBase64: base64,
      decoded: null,
      error: "Input is not a bplist base64 value"
    };
  }

  try {
    const arrayBuffer = base64ToArrayBuffer(base64);

    const logger = buildLeveledLogger({ logger: console, level: LogLevel.error });
    const reader = new Reader(arrayBuffer, logger);
    const bplistTopLevel = reader.buildTopLevelObject();
    const unarchived = tryResolveNSKeyedArchive(bplistTopLevel);

    return {
      success: true,
      rawBase64: base64,
      decoded: {
        bplistTopLevel: sanitizeForJson(bplistTopLevel),
        unarchived: sanitizeForJson(unarchived)
      }
    };
  } catch (error) {
    return {
      success: false,
      rawBase64: base64,
      decoded: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const maybeBuffer = (globalThis as { Buffer?: unknown }).Buffer;
  if (
    maybeBuffer &&
    typeof maybeBuffer === "function" &&
    "from" in maybeBuffer &&
    typeof (maybeBuffer as { from?: unknown }).from === "function"
  ) {
    const nodeBuffer = (maybeBuffer as { from: (input: string, encoding: string) => Uint8Array }).from(
      base64,
      "base64"
    );
    const view = new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength);
    const bytes = new Uint8Array(view.byteLength);
    bytes.set(view);
    return bytes.buffer;
  }

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  throw new Error("No base64 decoder available in this runtime (Buffer/atob missing)");
}

function tryResolveNSKeyedArchive(input: unknown): unknown | null {
  if (!isObject(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.$archiver !== "NSKeyedArchiver" || !Array.isArray(candidate.$objects)) {
    return null;
  }

  const top = candidate.$top;
  if (!isObject(top) || !(top.root instanceof Uid)) {
    return null;
  }

  const objects = candidate.$objects;
  const memo = new Map<number, unknown>();
  const resolving = new Set<number>();

  const resolveValue = (value: unknown): unknown => {
    if (value === null || value === undefined) {
      return value;
    }

    if (value instanceof Uid) {
      return resolveUid(value);
    }

    if (value instanceof ArrayBuffer) {
      return { type: "ArrayBuffer", byteLength: value.byteLength };
    }

    if (Array.isArray(value)) {
      return value.map(resolveValue);
    }

    if (isObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        out[key] = resolveValue(nested);
      }
      return out;
    }

    return value;
  };

  const resolveUid = (uid: Uid): unknown => {
    const idx = Number(uid.value);
    if (idx === 0) {
      return null;
    }

    if (!Number.isInteger(idx) || idx < 0 || idx >= objects.length) {
      return { $error: "uid-out-of-range", uid: String(uid.value) };
    }

    if (memo.has(idx)) {
      return memo.get(idx);
    }

    if (resolving.has(idx)) {
      return { $ref: idx };
    }

    resolving.add(idx);
    const raw = objects[idx];

    let decoded: unknown;
    if (isObject(raw) && raw.$class instanceof Uid) {
      const out: Record<string, unknown> = { $uid: idx };
      const classObject = objects[Number(raw.$class.value)];
      if (isObject(classObject) && typeof classObject.$classname === "string") {
        out.$className = classObject.$classname;
      }

      for (const [key, nested] of Object.entries(raw)) {
        if (key === "$class") {
          continue;
        }
        out[key] = resolveValue(nested);
      }
      decoded = out;
    } else {
      decoded = resolveValue(raw);
    }

    resolving.delete(idx);
    memo.set(idx, decoded);
    return decoded;
  };

  return resolveUid(top.root);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function sanitizeForJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Uid) {
    return { type: "Uid", value: value.value.toString() };
  }

  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    const ascii = tryDecodeAscii(bytes);
    return {
      type: "ArrayBuffer",
      byteLength: value.byteLength,
      ...(ascii ? { ascii } : {})
    };
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeForJson);
  }

  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = sanitizeForJson(nested);
    }
    return out;
  }

  return value;
}

function tryDecodeAscii(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0 || bytes.length > 128) {
    return undefined;
  }

  let out = "";
  for (const byte of bytes) {
    if (byte === 0) {
      continue;
    }
    if (byte < 32 || byte > 126) {
      return undefined;
    }
    out += String.fromCharCode(byte);
  }

  return out.length > 0 ? out : undefined;
}
