/** A trigger's signal groups as source lines — what the bubble quotes and History records. */

import type { SignalEnvelope } from "../../contract/types";
import type { SourceLine } from "../../io/bridge/message/message-bridge";
import { signalsOf } from "../backend/context-builder";
import type { BusEnvelope } from "../core/event-bus";

/** The deprecated `immediate` still arrives on the wire and counts as batched. */
export function deliveryClassOf(delivery: SignalEnvelope["delivery"]): SourceLine["delivery"] {
  return delivery === "urgent" ? "urgent" : "batched";
}

/** Urgent groups first; each delivery class otherwise in arrival order. */
export function sourceLinesOf(trigger: BusEnvelope): SourceLine[] {
  const lines = (signalsOf(trigger) ?? []).map(
    (group): SourceLine => ({
      delivery: deliveryClassOf(group.envelope.delivery),
      source: group.envelope.source,
      text: group.envelope.label ?? group.envelope.event_type,
    }),
  );
  return [
    ...lines.filter((line) => line.delivery === "urgent"),
    ...lines.filter((line) => line.delivery === "batched"),
  ];
}
