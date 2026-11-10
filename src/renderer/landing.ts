/** Her landing bounce on the canvas after a sit: a drop onto the seat and a squash about it, as a CSS transform. */

const LAND_MS = 620;
/** A timer floor past the animation's end, where a host pauses animations. */
const FLOOR_MS = 60;

const FRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(-24px) scale(1, 1)" },
  { opacity: 1, transform: "translateY(0) scale(1.12, 0.86)", offset: 0.42 },
  { transform: "translateY(-6px) scale(0.96, 1.05)", offset: 0.62 },
  { transform: "translateY(0) scale(1.05, 0.95)", offset: 0.8 },
  { opacity: 1, transform: "translateY(0) scale(1, 1)" },
];

export function createLanding(
  canvas: HTMLElement,
  getSeatPx: () => { x: number; y: number } | null,
): () => Promise<void> {
  let running: Animation | null = null;
  return async () => {
    if (running) {
      running.cancel();
      running = null;
      canvas.style.transformOrigin = "";
    }
    const seat = getSeatPx();
    if (!seat || typeof canvas.animate !== "function") return;
    canvas.style.transformOrigin = `${seat.x}px ${seat.y}px`;
    const anim = canvas.animate(FRAMES, { duration: LAND_MS, easing: "ease-in" });
    running = anim;
    await Promise.race([
      anim.finished.then(
        () => {},
        () => {},
      ),
      new Promise<void>((resolve) => setTimeout(resolve, LAND_MS + FLOOR_MS)),
    ]);
    // A newer landing owns the canvas now.
    if (running !== anim) return;
    anim.cancel();
    running = null;
    canvas.style.transformOrigin = "";
  };
}
