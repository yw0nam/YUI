/** The one bitmap → JPEG data URL encode the image paths share. */

const JPEG_QUALITY = 0.72;

/** Draws the bitmap on a canvas of that size and returns the JPEG data URL. */
export function encodeJpeg(bitmap: ImageBitmap, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  // A canvas with no backing store returns "data:," with no exception.
  if (!url.startsWith("data:image/jpeg;base64,")) throw new Error("no jpeg data");
  return url;
}
