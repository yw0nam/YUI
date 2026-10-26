/** The square of a preset's photo that its face shows, as ratios of the photo. */
export interface PhotoCrop {
  /** Left edge / photo width. */
  x: number;
  /** Top edge / photo height. */
  y: number;
  /** Square side / photo width. */
  size: number;
}

export interface PhotoSize {
  width: number;
  height: number;
}

/** The crop in `v`; undefined unless it is a square inside the photo's width, starting above its bottom. */
export function coercePhotoCrop(v: unknown): PhotoCrop | undefined {
  if (v === null || typeof v !== "object") return undefined;
  const { x, y, size } = v as Record<string, unknown>;
  if (![x, y, size].every(Number.isFinite)) return undefined;
  const c = v as PhotoCrop;
  if (c.x < 0 || c.y < 0 || c.y >= 1 || c.size <= 0 || c.size > 1 || c.x + c.size > 1 + 1e-6)
    return undefined;
  return { x: c.x, y: c.y, size: c.size };
}

/** The top square of a portrait photo, the centred square of any other. */
export function defaultCrop({ width, height }: PhotoSize): PhotoCrop {
  if (height > width) return { x: 0, y: 0, size: 1 };
  return { x: (width - height) / 2 / width, y: 0, size: height / width };
}

/** The largest square, centred on both axes. */
export function wholeCrop({ width, height }: PhotoSize): PhotoCrop {
  const side = Math.min(width, height);
  return { x: (width - side) / 2 / width, y: (height - side) / 2 / height, size: side / width };
}

/** A fixed framing for a full-body render: 55% of the width, centred, 6% from the top. */
export function faceCrop({ width, height }: PhotoSize): PhotoCrop {
  const side = Math.min(0.55 * width, height);
  return {
    x: (width - side) / 2 / width,
    y: Math.min(0.06 * height, height - side) / height,
    size: side / width,
  };
}
