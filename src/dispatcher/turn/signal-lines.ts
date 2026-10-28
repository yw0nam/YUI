/** A trigger's signal groups as source lines — what the bubble quotes and History records. */

import type { SourceLine } from "../../io/bridge/message/message-bridge";
import { signalsOf } from "../backend/context-builder";
import type { BusEnvelope } from "../core/event-bus";

/** Urgent groups first; each delivery class otherwise in arrival order. */
export function sourceLinesOf(trigger: BusEnvelope): SourceLine[] {
  const lines = (signalsOf(trigger) ?? []).map(
    (group): SourceLine => ({
      delivery: group.envelope.delivery,
      source: group.envelope.source,
      text: group.envelope.label ?? group.envelope.event_type,
    }),
  );
  return [
    ...lines.filter((line) => line.delivery === "urgent"),
    ...lines.filter((line) => line.delivery === "batched"),
  ];
}
