/**
 * placement — programmatic perch placement for agent-driven gestures.
 *
 * The inverse of the drag flow: the target is named instead of inferred, so this moves
 * the pet window until the seat lands on it, then hands the commit to the same sit /
 * peek commit a real drop uses. Never throws to the caller beyond what `invoke` does.
 */

import type { PeekConfig } from "../../../../config/validators/avatar/types";
import type { WindowRect } from "../../../../contract";
import type {
  PlacementOptions,
  PlacementRequest,
  PlacementResult,
} from "../../../../io/window/geometry/perch";
import { containsSeat } from "../../../../io/window/geometry/perch";
import { createLogger } from "../../../../logger";
import type { ScreenPoint } from "../../../../renderer/geometry/probe/perch-geometry";
import {
  type DropInvoke,
  type DropWindow,
  type PerchProbeSource,
  projectSeat,
} from "./perch-watch";

const log = createLogger("window-drop");

/** What a commit landed on; placement only reads the kind. */
interface CommitOutcome {
  kind: "sit" | "peek" | "none" | "interrupted";
}

export interface PlacementDeps {
  renderer: Pick<PerchProbeSource, "getPerchProbe">;
  invoke: DropInvoke;
  getWindow: () => DropWindow;
  getPeekConfig: () => PeekConfig;
  /** Stop the follow of an armed sit before the placement moves the pet window itself. */
  stopFollow(): void;
  commitSit(
    dropped: WindowRect,
    pos: { x: number; y: number },
    scale: number,
    charHpx: number,
    suppressCue: boolean,
  ): Promise<CommitOutcome>;
  commitPeek(
    target: WindowRect,
    side: "left" | "right",
    pos: { x: number; y: number },
    scale: number,
    charHpx: number,
    peekConfig: PeekConfig,
    suppressCue: boolean,
  ): CommitOutcome;
}

/**
 * Every window the app owns, front-to-back: exact owner-name matches first, then
 * partial ones. Plural because the frontmost match is not always sittable — Stage
 * Manager keeps thumbnails of the same app in front of the real window.
 */
function matchesByApp(windows: WindowRect[], app: string): number[] {
  const needle = app.toLowerCase();
  const indices = windows.map((_, i) => i);
  const exact = indices.filter((i) => windows[i].ownerName?.toLowerCase() === needle);
  const partial = indices.filter(
    (i) => !exact.includes(i) && windows[i].ownerName?.toLowerCase().includes(needle),
  );
  return [...exact, ...partial];
}

/** Where the seat must land (global points) for the requested gesture. */
function seatPointFor(request: PlacementRequest, target: WindowRect): ScreenPoint {
  if (request.kind === "sit") {
    return { x: target.x + target.width / 2, y: target.y };
  }
  return {
    x: request.side === "left" ? target.x : target.x + target.width,
    y: target.y + target.height / 2,
  };
}

export function createPlacement(
  deps: PlacementDeps,
): (request: PlacementRequest, opts?: PlacementOptions) => Promise<PlacementResult> {
  const { renderer, invoke, getWindow, getPeekConfig, stopFollow, commitSit, commitPeek } = deps;

  return async function placeOn(
    request: PlacementRequest,
    opts?: PlacementOptions,
  ): Promise<PlacementResult> {
    const probe = renderer.getPerchProbe();
    if (!probe) return { ok: false, reason: "unsupported" };
    const win = getWindow();
    const move = win.setPositionLogical?.bind(win);
    if (!move) return { ok: false, reason: "unsupported" };

    const [pos, scale, windows] = await Promise.all([
      win.outerPosition(),
      win.scaleFactor(),
      invoke("list_windows"),
    ]);
    // Front-to-back: sit considers every window the app owns, peek the frontmost
    // window outright.
    const candidates = request.kind === "sit" ? matchesByApp(windows, request.app) : [0];
    if (candidates.length === 0 || windows.length === 0) {
      return { ok: false, reason: "not_found" };
    }
    // Take the frontmost candidate whose own seat point is reachable. The covered
    // predicate is the drop path's: a window in front of that candidate holding its
    // seat point means the character would land on that window's surface instead.
    // Only when no candidate is reachable is the request genuinely blocked.
    let chosen: { index: number; target: WindowRect; seat: ScreenPoint } | undefined;
    for (const index of candidates) {
      const target = windows[index];
      const seat = seatPointFor(request, target);
      if (!windows.some((w, i) => i < index && containsSeat(w, seat))) {
        chosen = { index, target, seat };
        break;
      }
      log.debug("placement.candidate_covered", {
        kind: request.kind,
        targetWindowNumber: target.windowNumber,
        seatX: Math.round(seat.x),
        seatY: Math.round(seat.y),
      });
    }
    if (!chosen) {
      log.debug("placement.blocked", { kind: request.kind, candidates: candidates.length });
      return { ok: false, reason: "blocked" };
    }
    const { target, seat } = chosen;

    // Invert projectSeat in points: the physical origin is read with its scale, written back logical.
    const sf = scale > 0 ? scale : 1;
    const current = projectSeat(probe, pos, scale);
    const next = {
      x: pos.x / sf + (seat.x - current.x),
      y: pos.y / sf + (seat.y - current.y),
    };
    stopFollow();
    await move(next.x, next.y);
    // The move may be clamped or cross onto another scale, so position and scale are read together after it.
    const [applied, appliedScale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
    log.debug("placement.moved", {
      kind: request.kind,
      x: applied.x,
      y: applied.y,
      requestedXPts: next.x,
      requestedYPts: next.y,
    });
    // Last gate before any side effect: a drag that started during the move wins, and
    // abandoning here keeps the reported outcome honest — nothing was pushed or armed.
    if (opts?.shouldAbort?.()) {
      log.debug("placement.aborted", { kind: request.kind });
      return { ok: false, reason: "interrupted" };
    }
    if (request.kind === "sit") {
      const outcome = await commitSit(target, applied, appliedScale, probe.charHpx, true);
      if (outcome.kind === "interrupted") return { ok: false, reason: "interrupted" };
      if (outcome.kind === "none") return { ok: false, reason: "not_found" };
    } else {
      commitPeek(target, request.side, applied, appliedScale, probe.charHpx, getPeekConfig(), true);
    }
    return { ok: true, kind: request.kind };
  };
}
