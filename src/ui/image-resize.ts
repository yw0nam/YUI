/**
 * Downscale + JPEG re-encode for user-attached images before they enter the
 * attachments array. Vision models downscale anything past ~1.3–1.6k long edge
 * anyway, so we send the small-but-legible payload instead of full-res base64.
 */

import { createLogger } from "../logger";

const log = createLogger("image-resize");

// Tunable knobs: long edge cap (px) and JPEG quality.
export const MAX_LONG_EDGE = 1280;
export const JPEG_QUALITY = 0.72;

export interface Dims {
  width: number;
  height: number;
}

// Fit so the long edge is ≤ cap, preserving aspect ratio. Never upscales.
export function fitLongEdge(width: number, height: number, maxLongEdge = MAX_LONG_EDGE): Dims {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Decode → downscale → JPEG data URL. Falls back to the original data URL on
// any decode/encode failure so the attachment is never dropped silently.
export async function downscaleToJpeg(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitLongEdge(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch (err) {
    log.warn("downscale_failed", { name: file.name, error: String(err) });
    return readAsDataUrl(file);
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
