/**
 * MotionPreemption — renderer-internal primitive that surfaces motion supersession.
 * NO three.js import. No rendering side-effects.
 *
 * 책임: 현재 모션이 다른 모션으로 교체/폐기될 때 외부 구독자에게 통지(preempt),
 * 그리고 매 교체/폐기마다 증가하는 generation 카운터를 노출 — 비동기 작업(예: fall
 * 컨트롤러의 setPosition)이 cancel/dispose/새 시퀀스 이후 stale인지 판별하게 한다.
 *
 * Exported surface:
 *   createMotionPreemption() → MotionPreemption
 */

export interface MotionPreemptedEvent {
  /** id of the motion that was active and got superseded. */
  prevId: string;
  /** id of the motion that took over, or null when the VRM is disposed/torn down. */
  nextId: string | null;
}

export type MotionPreemptedCallback = (e: MotionPreemptedEvent) => void;

export interface MotionPreemption {
  /** Subscribe to supersession events. Returns an unsubscribe fn. */
  onMotionPreempted(cb: MotionPreemptedCallback): () => void;
  /**
   * Signal that `prevId` was superseded by `nextId` (null on dispose). Bumps the
   * generation first, then fans out to subscribers — a callback reads the fresh gen.
   */
  preempt(prevId: string, nextId: string | null): void;
  /** Current monotonic generation. A caller captures this and re-checks for staleness. */
  generation(): number;
  /** True iff `captured` matches the live generation (no preemption/dispose since). */
  isCurrent(captured: number): boolean;
}

export function createMotionPreemption(): MotionPreemption {
  const subscribers = new Set<MotionPreemptedCallback>();
  let gen = 0;

  return {
    onMotionPreempted(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    preempt(prevId, nextId) {
      gen++;
      const event: MotionPreemptedEvent = { prevId, nextId };
      for (const cb of subscribers) {
        try {
          cb(event);
        } catch {
          // 한 구독자의 throw가 나머지 통지를 막지 않도록 격리.
        }
      }
    },
    generation() {
      return gen;
    },
    isCurrent(captured) {
      return captured === gen;
    },
  };
}
