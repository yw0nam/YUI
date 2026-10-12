/** Shrinks a turn's images to the byte budget the backend stated for the frame. */

/** Two quotes and a comma around each entry in the JSON frame. */
const JSON_OVERHEAD_BYTES = 3;
/** Re-encode passes per image before it is left as it was. */
const MAX_PASSES = 4;
const JPEG_QUALITY = 0.72;

export async function fitTurnImages(images: string[], budgetBytes: number): Promise<string[]> {
  const total =
    images.reduce((sum, image) => sum + image.length, 0) + images.length * JSON_OVERHEAD_BYTES;
  if (total <= budgetBytes) return images;
  // A data URL is ASCII, so its byte size is its length.
  const share = Math.floor(budgetBytes / images.length) - JSON_OVERHEAD_BYTES;
  // The text alone fills the frame, so no image size fits.
  if (share <= 0) return images;
  return Promise.all(images.map((image) => (image.length > share ? fitOne(image, share) : image)));
}

async function fitOne(image: string, share: number): Promise<string> {
  let current = image;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = await reencode(current, share);
    if (next === null) return image;
    current = next;
    if (current.length <= share) return current;
  }
  return image;
}

async function reencode(image: string, share: number): Promise<string | null> {
  try {
    const comma = image.indexOf(",");
    const raw = atob(image.slice(comma + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const bitmap = await createImageBitmap(new Blob([bytes]));
    // Area, hence each edge, shrinks by the square root of the byte overage.
    const scale = Math.sqrt(share / image.length) * 0.9;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    if (!ctx) return null;
    const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    // A canvas with no backing store returns "data:," with no exception.
    return url.startsWith("data:image/jpeg;base64,") ? url : null;
  } catch {
    return null;
  }
}
