/**
 * session.test.ts — Usage 타입의 런타임 narrowing 검증.
 *
 * 타입 자체는 컴파일 타임 검사(pnpm build)가 1차 게이트지만, 여기서 필드 접근 가능한지를
 * 런타임 값으로 굳힌다.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { Usage } from "./types";

describe("Usage", () => {
  it("response.completed usage 모양(input/output/total)을 담는다", () => {
    const usage: Usage = { input_tokens: 120, output_tokens: 30, total_tokens: 150 };
    expect(usage.total_tokens).toBe(usage.input_tokens + usage.output_tokens);
    expectTypeOf<Usage["input_tokens"]>().toEqualTypeOf<number>();
  });
});
