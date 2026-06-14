import { defineConfig } from "vitest/config";

// Unit/integration harness — vitest + playwright.
// node 환경 — 현재 테스트는 순수 로직/아티팩트 검증(DOM 불필요). 렌더러 테스트가
// 생기면 해당 파일만 // @vitest-environment jsdom 로 opt-in.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
