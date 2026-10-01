/** Resolve once the browser has fetched and decoded the image at `url`; reject when it cannot. */
export async function decodeImage(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  await img.decode();
}
