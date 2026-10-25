/** Pure routing for the unified chat window: who a message goes to, and the one-at-a-time delivery of a send. */

import type { UserTurnDone, UserTurnRouted } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import type { Row } from "./merge";

const log = createLogger("router");

/** The preset id of the newest row a preset spoke. */
export function lastSpeakerOf(rows: readonly Row[]): string | undefined {
  return rows.findLast((r) => r.who !== "user")?.who;
}

/** The presets a message goes to: everyone in a shuffled order, a picked preset, or the last speaker. */
export function targetsFor(p: {
  /** A preset id, "everyone", or no mention. */
  mention: string | null;
  cast: readonly string[];
  lastSpeaker: string | undefined;
  mainId: string;
  shuffle: (ids: string[]) => string[];
}): string[] {
  if (p.mention === "everyone") return p.shuffle([...p.cast]);
  if (p.mention) return [p.mention];
  return [[p.lastSpeaker, p.mainId].find((id) => id && p.cast.includes(id)) ?? p.cast[0]!];
}

export interface Send {
  sendId: string;
  targets: string[];
  text: string;
  mention?: UserTurnRouted["mention"];
}

/** Delivers one send at a time, one target at a time; a done for the current send and target, or 60 s, moves on. */
// ponytail: one queue, one timeout; no per-target retry while the backend answers nearly every turn
export function createSequence(deps: {
  emit: (event: UserTurnRouted) => void;
  /** A queued send reached the front and is about to be emitted. */
  onStart?: (sendId: string) => void;
  timeoutMs?: number;
}): { run(send: Send): void; turnDone(done: UserTurnDone): void; dispose(): void } {
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const queue: Send[] = [];
  let current: { send: Send; index: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function emitCurrent(): void {
    const { send, index } = current!;
    const to = send.targets[index]!;
    deps.emit({
      sendId: send.sendId,
      to,
      text: send.text,
      ...(send.mention ? { mention: send.mention } : {}),
    });
    timer = setTimeout(() => {
      log.info("sequence_timeout", { preset: to });
      advance();
    }, timeoutMs);
  }

  function startNext(): void {
    const send = queue.shift();
    if (!send) {
      current = null;
      return;
    }
    current = { send, index: 0 };
    deps.onStart?.(send.sendId);
    emitCurrent();
  }

  function advance(): void {
    clearTimeout(timer);
    if (!current) return;
    current.index++;
    if (current.index < current.send.targets.length) emitCurrent();
    else startNext();
  }

  return {
    run(send) {
      queue.push(send);
      if (!current) startNext();
    },
    turnDone({ sendId, preset }) {
      if (current?.send.sendId === sendId && current.send.targets[current.index] === preset)
        advance();
    },
    dispose() {
      clearTimeout(timer);
      queue.length = 0;
      current = null;
    },
  };
}
