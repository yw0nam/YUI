/** Admission — which holds keep a candidate from going out now: do-not-disturb, the proactive gap, absence, the hourly cap. */

import { isDndHeld, PACED_SOURCES, waitsForPresence } from "./classify";
import type { BusEnvelope } from "./event-bus";
import type { Guardrails } from "./guardrails";
import type { ProactivePacer } from "./proactive-pacer";
import type { WaitingEntry } from "./waiting-list";

export interface Admission {
  heldByPacer(env: BusEnvelope): boolean;
  heldByDnd(env: BusEnvelope): boolean;
  /** Do-not-disturb holds the trigger or, unless the user started it, one of its members. */
  heldByDndAny(env: BusEnvelope, members: readonly WaitingEntry[]): boolean;
  /** Whether a candidate may go out once the slot is free. */
  admissible(env: BusEnvelope): boolean;
}

export function createAdmission(deps: {
  guardrails: Pick<Guardrails, "canSpend">;
  pacer?: Pick<ProactivePacer, "isHolding">;
  isDndOn?: () => boolean;
  /** Absent counts as present. */
  isPresent?: () => boolean;
}): Admission {
  const heldByPacer = (env: BusEnvelope): boolean =>
    PACED_SOURCES[env.source] && deps.pacer?.isHolding() === true;
  const heldByDnd = (env: BusEnvelope): boolean => deps.isDndOn?.() === true && isDndHeld(env);
  return {
    heldByPacer,
    heldByDnd,
    heldByDndAny: (env, members) =>
      heldByDnd(env) || (env.dnd_override !== true && members.some((m) => heldByDnd(m.env))),
    admissible: (env) =>
      !heldByDnd(env) &&
      !heldByPacer(env) &&
      !(waitsForPresence(env) && deps.isPresent?.() === false) &&
      deps.guardrails.canSpend(env),
  };
}
