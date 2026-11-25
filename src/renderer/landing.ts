/** Her landing bounce on the canvas, and her vanishing from and appearing on it, as CSS animations. */

const LAND_MS = 620;
const VANISH_MS = 180;
const APPEAR_MS = 200;
/** A timer floor past the animation's end, where a host pauses animations. */
const FLOOR_MS = 60;

const LAND: Keyframe[] = [
  { opacity: 0, transform: "translateY(-24px) scale(1, 1)" },
  { opacity: 1, transform: "translateY(0) scale(1.12, 0.86)", offset: 0.42 },
  { transform: "translateY(-6px) scale(0.96, 1.05)", offset: 0.62 },
  { transform: "translateY(0) scale(1.05, 0.95)", offset: 0.8 },
  { opacity: 1, transform: "translateY(0) scale(1, 1)" },
];
const VANISH: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
const APPEAR: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

type Point = { x: number; y: number };

export function createLanding(
  canvas: HTMLElement,
  getSeatPx: () => Point | null,
): {
  land(origin?: Point | null): Promise<void>;
  vanish(): Promise<void>;
  appear(): Promise<void>;
} {
  let running: Animation | null = null;

  const stop = (): void => {
    running?.cancel();
    running = null;
    canvas.style.transformOrigin = "";
  };

  /** Plays one animation; a `forwards` fill stays on the canvas until the next animation cancels it. */
  async function play(frames: Keyframe[], opts: KeyframeAnimationOptions & { duration: number }) {
    if (typeof canvas.animate !== "function") return;
    const anim = canvas.animate(frames, opts);
    running = anim;
    await Promise.race([
      anim.finished.then(
        () => {},
        () => {},
      ),
      new Promise<void>((resolve) => setTimeout(resolve, opts.duration + FLOOR_MS)),
    ]);
    // A newer animation owns the canvas now.
    if (opts.fill === "forwards" || running !== anim) return;
    stop();
  }

  const appear = (): Promise<void> => {
    stop();
    return play(APPEAR, { duration: APPEAR_MS });
  };

  return {
    land(origin) {
      if (origin === null) return appear();
      stop();
      const at = origin ?? getSeatPx();
      if (!at) return Promise.resolve();
      canvas.style.transformOrigin = `${at.x}px ${at.y}px`;
      return play(LAND, { duration: LAND_MS, easing: "ease-in" });
    },
    vanish() {
      stop();
      return play(VANISH, { duration: VANISH_MS, fill: "forwards" });
    },
    appear,
  };
}
