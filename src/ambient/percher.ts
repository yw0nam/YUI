import type { PerchWalkConfig } from "../config/load";
import type { WindowRect } from "../contract";
import { MOVE_TH, PERCH_AMBIGUOUS_LOST_TICKS, PERCH_POLL_MS } from "../io/window-drop-source";
import { createLogger } from "../logger";
import type { TickFn } from "../renderer";

const log = createLogger("percher");

type Rng = () => number;

export function nextPerchDwell(cfg: PerchWalkConfig, rng: Rng = Math.random): number {
  return cfg.dwell_min_ms + (cfg.dwell_max_ms - cfg.dwell_min_ms) * rng();
}

export function planPerchStroll(opts: {
  currentX: number;
  winLeft: number;
  winRight: number;
  charHpx: number;
  cfg: PerchWalkConfig;
  rng?: Rng;
}): { centerX: number; direction: -1 | 1 } | null {
  const rng = opts.rng ?? Math.random;
  const margin = opts.cfg.edge_margin_frac * opts.charHpx;
  const left = opts.winLeft + margin;
  const right = opts.winRight - margin;
  if (right < left) return null;
  const roomLeft = opts.currentX - left;
  const roomRight = right - opts.currentX;
  const leftOk = roomLeft >= opts.cfg.distance_min_px;
  const rightOk = roomRight >= opts.cfg.distance_min_px;
  if (!leftOk && !rightOk) return null;
  const direction: -1 | 1 = leftOk && rightOk ? (rng() < 0.5 ? -1 : 1) : leftOk ? -1 : 1;
  const room = direction < 0 ? roomLeft : roomRight;
  const max = Math.min(opts.cfg.distance_max_px, room);
  const distance = opts.cfg.distance_min_px + (max - opts.cfg.distance_min_px) * rng();
  const centerX = Math.min(right, Math.max(left, opts.currentX + direction * distance));
  return { centerX, direction };
}

interface PercherWindow {
  outerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
  setPositionPhysical(x: number, y: number): Promise<void>;
}

interface SuspendedSit {
  windowNumber: number;
  origin: "commit" | "adopt";
  rect: { x: number; y: number };
  charHpx: number;
}

export interface PercherDeps {
  renderer: {
    onTick(fn: TickFn): () => void;
    getCharacterAnchor(): { x: number; y: number } | null;
    getPerchProbe(): { seatPx: { x: number; y: number }; charHpx: number } | null;
  };
  getWindow(): PercherWindow;
  listWindows(): Promise<WindowRect[]>;
  getConfig(): PerchWalkConfig;
  walker: { walkTo(toX: number): Promise<"arrived" | "lost">; cancel(): void };
  dropSource: {
    armedSit(): { windowNumber: number; origin: "commit" | "adopt" } | null;
    suspendSit(): SuspendedSit | null;
    resumeSit(edgeLocalYpx: number): void;
    release(): void;
  };
  onWalkStart(): void;
  onWalkEnd(): void;
  onWalkCancel(): void;
  onSit(target: WindowRect, edgeLocalYpx: number): void;
  rng?: Rng;
}

export interface Percher {
  start(): void;
  cancel(): void;
  stop(): void;
}

export function createPercher(deps: PercherDeps): Percher {
  const rng = deps.rng ?? Math.random;
  let unsub: (() => void) | null = null;
  let stopped = true;
  let generation = 0;
  let dwellAtMs = -1;
  let nowMs = 0;
  let starting = false;
  let stroll: {
    host: WindowRect;
    nextWatchAtMs: number;
    lostStreak: number;
    watching: boolean;
  } | null = null;

  function alive(startedAt: number): boolean {
    return !stopped && generation === startedAt;
  }

  function cancel(): void {
    generation++;
    dwellAtMs = -1;
    starting = false;
    if (stroll) {
      deps.walker.cancel();
      deps.onWalkCancel();
    }
    stroll = null;
  }

  function loseHost(startedAt: number): void {
    if (!alive(startedAt) || !stroll) return;
    generation++;
    stroll = null;
    dwellAtMs = -1;
    deps.walker.cancel();
    deps.onWalkEnd();
    deps.dropSource.release();
  }

  function watchHost(): void {
    const active = stroll;
    if (!active || active.watching || nowMs < active.nextWatchAtMs) return;
    active.nextWatchAtMs = nowMs + PERCH_POLL_MS;
    active.watching = true;
    const startedAt = generation;
    void deps
      .listWindows()
      .then((windows) => {
        if (!alive(startedAt) || stroll !== active) return;
        const host = windows.find(
          (candidate) => candidate.windowNumber === active.host.windowNumber,
        );
        if (!host) {
          loseHost(startedAt);
          return;
        }
        const moved =
          Math.abs(host.x - active.host.x) > MOVE_TH || Math.abs(host.y - active.host.y) > MOVE_TH;
        active.lostStreak = moved ? active.lostStreak + 1 : 0;
        if (active.lostStreak >= PERCH_AMBIGUOUS_LOST_TICKS) loseHost(startedAt);
      })
      .catch((error) => log.warn("host_watch_failed", { degrade: true, error: String(error) }))
      .finally(() => {
        active.watching = false;
      });
  }

  async function strollOnce(): Promise<void> {
    const startedAt = generation;
    const armed = deps.dropSource.armedSit();
    if (armed?.origin !== "commit") return;
    const anchor = deps.renderer.getCharacterAnchor();
    const probe = deps.renderer.getPerchProbe();
    if (!anchor || !probe) return;
    const win = deps.getWindow();
    const [pos, scaleFactor, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      deps.listWindows(),
    ]);
    if (!alive(startedAt)) return;
    const host = windows.find((candidate) => candidate.windowNumber === armed.windowNumber);
    if (!host) {
      deps.dropSource.release();
      return;
    }
    const scale = scaleFactor > 0 ? scaleFactor : 1;
    const plan = planPerchStroll({
      currentX: pos.x / scale + anchor.x,
      winLeft: host.x,
      winRight: host.x + host.width,
      charHpx: probe.charHpx,
      cfg: deps.getConfig(),
      rng,
    });
    if (!plan) {
      dwellAtMs = nowMs + nextPerchDwell(deps.getConfig(), rng);
      return;
    }
    const suspended = deps.dropSource.suspendSit();
    if (suspended?.origin !== "commit") return;
    let walkStarted = false;
    try {
      const standingY = Math.round((host.y - anchor.y) * scale);
      await win.setPositionPhysical(pos.x, standingY);
      if (!alive(startedAt)) return;
      stroll = {
        host,
        nextWatchAtMs: nowMs + PERCH_POLL_MS,
        lostStreak: 0,
        watching: false,
      };
      deps.onWalkStart();
      walkStarted = true;
      await deps.walker.walkTo(plan.centerX - anchor.x);
      if (!alive(startedAt) || !stroll) return;
      stroll = null;
      deps.onWalkEnd();
      walkStarted = false;
      const applied = await win.outerPosition();
      if (!alive(startedAt)) return;
      const edgeLocalYpx = host.y - applied.y / scale;
      deps.dropSource.resumeSit(edgeLocalYpx);
      deps.onSit(host, edgeLocalYpx);
      dwellAtMs = nowMs + nextPerchDwell(deps.getConfig(), rng);
    } catch (error) {
      if (!alive(startedAt)) throw error;
      stroll = null;
      if (walkStarted) {
        deps.walker.cancel();
        deps.onWalkEnd();
      }
      const applied = await win.outerPosition();
      if (alive(startedAt)) {
        const edgeLocalYpx = host.y - applied.y / scale;
        deps.dropSource.resumeSit(edgeLocalYpx);
        deps.onSit(host, edgeLocalYpx);
        dwellAtMs = nowMs + nextPerchDwell(deps.getConfig(), rng);
      }
      throw error;
    }
  }

  function tick(ctx: { elapsed: number }): void {
    nowMs = ctx.elapsed * 1000;
    if (stroll) {
      watchHost();
      return;
    }
    if (starting) return;
    const sit = deps.dropSource.armedSit();
    if (sit?.origin !== "commit") {
      dwellAtMs = -1;
      return;
    }
    if (dwellAtMs < 0) {
      dwellAtMs = nowMs + nextPerchDwell(deps.getConfig(), rng);
      return;
    }
    if (nowMs < dwellAtMs) return;
    dwellAtMs = -1;
    starting = true;
    void strollOnce()
      .catch((error) => log.warn("stroll_failed", { degrade: true, error: String(error) }))
      .finally(() => {
        starting = false;
      });
  }

  return {
    start() {
      if (unsub) return;
      stopped = false;
      dwellAtMs = -1;
      unsub = deps.renderer.onTick(tick);
    },
    cancel,
    stop() {
      stopped = true;
      cancel();
      unsub?.();
      unsub = null;
    },
  };
}
