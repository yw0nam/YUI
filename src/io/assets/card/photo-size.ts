import type { PhotoSize } from "../../../settings/preset/photo-crop";

/** The natural size of the image at `url`; rejects when it cannot be decoded. */
export async function loadPhotoSize(url: string): Promise<PhotoSize> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}
