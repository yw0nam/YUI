/** Waits for the pet window's page to take a new size and the renderer to refit to it. */

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

/** One frame past the page reaching `width` × `height`, so the renderer's refit has run. */
export async function waitRefit(width: number, height: number): Promise<void> {
  for (let frame = 0; frame < 60; frame += 1) {
    if (window.innerWidth === Math.round(width) && window.innerHeight === Math.round(height)) {
      break;
    }
    await nextFrame();
  }
  await nextFrame();
}
