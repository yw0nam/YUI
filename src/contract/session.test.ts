/**
 * session.test.ts — Usage + SessionCompressionResponse 타입의 런타임 narrowing 검증.
 *
 * 타입 자체는 컴파일 타임 검사(pnpm build)가 1차 게이트지만, 여기서 status 판별자로
 * 좁힌 뒤 status별 전용 필드에 접근 가능한지(=union 모양이 의도대로인지)를 런타임 값으로 굳힌다.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { SessionCompressionResponse, Usage } from "./types";

describe("Usage", () => {
  it("response.completed usage 모양(input/output/total)을 담는다", () => {
    const usage: Usage = { input_tokens: 120, output_tokens: 30, total_tokens: 150 };
    expect(usage.total_tokens).toBe(usage.input_tokens + usage.output_tokens);
    expectTypeOf<Usage["input_tokens"]>().toEqualTypeOf<number>();
  });
});

describe("SessionCompressionResponse", () => {
  it("status=compressed는 토큰/메시지/removed/previous_session_id를 노출한다", () => {
    const res: SessionCompressionResponse = {
      object: "hermes.session.compression",
      status: "compressed",
      session_id: "s-2",
      previous_session_id: "s-1",
      before_messages: 40,
      after_messages: 12,
      before_tokens: 18000,
      after_tokens: 4000,
      removed: 28,
    };
    if (res.status === "compressed") {
      expect(res.after_tokens).toBeLessThan(res.before_tokens);
      expect(res.previous_session_id).toBe("s-1");
      expectTypeOf(res.removed).toEqualTypeOf<number>();
    }
  });

  it("status=skipped는 reason을 노출하고 session_id는 공통이다", () => {
    const res: SessionCompressionResponse = {
      object: "hermes.session.compression",
      status: "skipped",
      session_id: "s-1",
      reason: "below_threshold",
    };
    expect(res.session_id).toBe("s-1");
    if (res.status === "skipped") {
      expect(res.reason).toBe("below_threshold");
    }
  });

  it("status로 좁히기 전에는 session_id만 공통 접근 가능하다", () => {
    const res = {
      object: "hermes.session.compression",
      status: "skipped",
      session_id: "s-9",
      reason: "below_threshold",
      extra_field_from_server: true,
    } as SessionCompressionResponse;
    expect(res.session_id).toBe("s-9");
  });
});
