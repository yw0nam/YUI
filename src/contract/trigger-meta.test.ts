/**
 * trigger-meta.test.ts — locks the shape of TriggerMeta.kind "signals". Compile-time checks (pnpm build) are
 * the primary gate, but this test fixes the value-level assertion that signals remains an opaque array (structure unspecified).
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { SignalEnvelope, SignalGroup, SignalItem, TriggerMeta } from "./types";

describe("TriggerMeta kind=signals", () => {
  it("AC1: trigger.signals stores opaque items in legacy groups", () => {
    const trigger: TriggerMeta = {
      kind: "signals",
      signals: [
        {
          items: [
            { source: "github", repo: "acme/yui", event: "push" },
            { source: "notion", page_id: "abc123", title: "Task" },
          ],
        },
      ],
    };
    expect(trigger.signals?.[0].items).toHaveLength(2);
    expectTypeOf<SignalItem>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<TriggerMeta["signals"]>().toEqualTypeOf<SignalGroup[] | undefined>();
  });

  it("signals 항목은 구조가 서로 달라도 타입 에러 없이 공존한다", () => {
    const items: SignalItem[] = [{ a: 1 }, { b: "x", c: [1, 2, 3] }, {}];
    expect(items).toHaveLength(3);
  });

  it("AC3: SignalEnvelope exposes the closed delivery contract", () => {
    const envelope: SignalEnvelope = {
      source: "n8n",
      event_type: "workflow_done",
      delivery: "batched",
      event_id: "run-1",
      occurred_at: 1_787_449_000_000,
    };
    expect(envelope.delivery).toBe("batched");
  });
});
