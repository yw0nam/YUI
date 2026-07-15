/**
 * trigger-meta.test.ts — locks the shape of TriggerMeta.kind "signals". Compile-time checks (pnpm build) are
 * the primary gate, but this test fixes the value-level assertion that signals remains an opaque array (structure unspecified).
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { SignalItem, TriggerMeta } from "./types";

describe("TriggerMeta kind=signals", () => {
  it("trigger.signals는 이종 항목을 그대로 담는 opaque 배열이다", () => {
    const trigger: TriggerMeta = {
      kind: "signals",
      signals: [
        { source: "github", repo: "acme/yui", event: "push" },
        { source: "notion", page_id: "abc123", title: "Task" },
        { source: "heartbeat", ts: 1781000000000 },
      ],
    };
    expect(trigger.signals).toHaveLength(3);
    expectTypeOf<SignalItem>().toEqualTypeOf<Record<string, unknown>>();
  });

  it("signals 항목은 구조가 서로 달라도 타입 에러 없이 공존한다", () => {
    const items: SignalItem[] = [{ a: 1 }, { b: "x", c: [1, 2, 3] }, {}];
    expect(items).toHaveLength(3);
  });
});
