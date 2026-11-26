/** Waits for the pet window's page to take a new size and the renderer to refit to it. */

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

/** Within a pixel: a fractional scale rounds the page's size either way. */
const near = (page: number, size: number): boolean => Math.abs(page - size) <= 1;

/** One frame past the page reaching `width` × `height`, so the renderer's refit has run. */
export async function waitRefit(width: number, height: number): Promise<void> {
  for (let frame = 0; frame < 60; frame += 1) {
    if (near(window.innerWidth, width) && near(window.innerHeight, height)) break;
    await nextFrame();
  }
  await nextFrame();
}
