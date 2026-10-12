/**
 * Downscale + JPEG re-encode for user-attached images before they enter the
 * attachments array. Vision models downscale anything past ~1.3–1.6k long edge
 * anyway, so we send the small-but-legible payload instead of full-res base64.
 */

import { encodeJpeg } from "../../io/image/jpeg-encode";
import { createLogger } from "../../logger";

const log = createLogger("image-resize");

// Tunable knob: long edge cap (px).
export const MAX_LONG_EDGE = 1280;

interface Dims {
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

// Decode → downscale → JPEG data URL. Rejects when any step fails — a broken
// image has nothing to send — and when the canvas yields no JPEG data.
export async function downscaleToJpeg(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitLongEdge(bitmap.width, bitmap.height);
    return encodeJpeg(bitmap, width, height);
  } catch (err) {
    log.warn("downscale_failed", { name: file.name, error: String(err) });
    throw err;
  }
}
