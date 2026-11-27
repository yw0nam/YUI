/**
 * Waiting release — what one free slot sends: the admissible waiting entries as one envelope,
 * with the drained batched signal groups, and the envelope shapes that carry them.
 *
 * Pure apart from the list and the drain it is handed: no clock, no I/O.
 */

import type { SignalGroup } from "../../contract";
import { isAddressedEvent, userTurnSourceOf } from "./classify";
import type { BusEnvelope } from "./event-bus";
import type { WaitingEntry, WaitingList } from "./waiting-list";

/** The signal groups an envelope carries in `payload.signals`. */
export const groupsOf = (env: BusEnvelope): SignalGroup[] =>
  Array.isArray(env.payload?.signals) ? (env.payload.signals as SignalGroup[]) : [];

/** The envelope drained batched groups travel on alone, and the shape every restore hands back. */
export const catchupOf = (signals: SignalGroup[], ts: number): BusEnvelope => ({
  source: "timer_scheduler",
  event_name: "signals.catchup",
  ts,
  payload: { signals },
});

/** The envelope without its own signal groups, which go back to their buffers while it waits. */
export function withoutSignals(env: BusEnvelope): { env: BusEnvelope; groups: SignalGroup[] } {
  const groups = groupsOf(env);
  if (groups.length === 0) return { env, groups };
  const { signals: _carried, ...payload } = env.payload ?? {};
  return { env: { ...env, payload }, groups };
}

/** `top` carrying `rest` as `payload.waited` and `groups` as `payload.signals`; `top` itself when both are empty. */
export function withWaited(
  top: BusEnvelope,
  rest: readonly WaitingEntry[],
  groups: SignalGroup[],
): BusEnvelope {
  if (rest.length === 0 && groups.length === 0) return top;
  return {
    ...top,
    payload: {
      ...top.payload,
      waited: rest.map((e) => e.env),
      ...(groups.length > 0 ? { signals: groups } : {}),
    },
  };
}

/** How many addressed turns a trigger counts once admitted; the lines riding a user turn count none. */
export const addressedIn = (env: BusEnvelope, members: readonly WaitingEntry[]): number =>
  userTurnSourceOf(env) ? 0 : members.filter((m) => isAddressedEvent(m.env)).length;

export interface ReleaseInput {
  list: WaitingList;
  /** Whether a candidate may go out once the slot is free. */
  admissible: (env: BusEnvelope) => boolean;
  /** The addressed chain's room, with `pending` addressed entries already taken. */
  canAdmit: (pending: number) => boolean;
  /** The cap the admission reads, stamped on each admitted addressed envelope. */
  exchangeMax: () => number;
  /** Drained groups may join waiting entries: do-not-disturb is off. */
  groupsJoin: boolean;
  /** Drained groups may go out alone: the edge into a free slot. */
  catchupEdge: boolean;
  drain: () => SignalGroup[];
  now: number;
}

/**
 * Takes the admissible entries in rank order, stopping addressed ones at the chain's room, and
 * drains the groups that may go with them. `overCap` are the addressed entries the chain refuses.
 */
export function planRelease(input: ReleaseInput): {
  trigger?: BusEnvelope;
  members: WaitingEntry[];
  groups: SignalGroup[];
  overCap: WaitingEntry[];
} {
  let addressed = 0;
  const members = input.list.take((w) => {
    if (!input.admissible(w.env)) return false;
    if (!isAddressedEvent(w.env)) return true;
    if (!input.canAdmit(addressed)) return false;
    addressed += 1;
    // Stamp the max the admission used, for the context's exchange line.
    w.env.payload = { ...w.env.payload, exchange: { max: input.exchangeMax() } };
    return true;
  });
  const overCap = input.list.take((w) => isAddressedEvent(w.env) && !input.canAdmit(addressed));
  const [top, ...rest] = members;
  const drains = top ? input.groupsJoin : input.catchupEdge;
  const groups = drains ? input.drain() : [];
  let trigger: BusEnvelope | undefined;
  if (top) trigger = withWaited(top.env, rest, groups);
  else if (groups.length > 0) trigger = catchupOf(groups, input.now);
  return { trigger, members, groups, overCap };
}
