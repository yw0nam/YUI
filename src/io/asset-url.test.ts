/**
 * asset-url.test.ts — 논리 에셋 경로 → 런타임 URL resolver 단위 테스트.
 *
 * dev/브라우저(__TAURI_INTERNALS__ 없음)는 입력 경로를 그대로 통과시키고(vite 서빙 보존),
 * Tauri 패키징은 resolveResource + convertFileSrc로 번들 리소스 절대 URL을 만든다.
 * Tauri API는 주입 가능 — 실제 @tauri-apps/api를 타지 않고 mock으로 분기를 검증한다.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveAssetUrl, type TauriAssetApi } from "./asset-url";

/** 번들 리소스 경로를 흉내내는 mock — resolveResource는 절대 fs 경로, convertFileSrc는 asset URL. */
function mockTauri(): TauriAssetApi {
  return {
    resolveResource: vi.fn(async (p: string) => `/app/resources/${p}`),
    convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURI(p)}`),
  };
}

describe("resolveAssetUrl — dev/browser passthrough", () => {
  it("Tauri가 아니면 입력 경로를 그대로 반환한다", async () => {
    const out = await resolveAssetUrl("/configs/endpoints.json", {
      isTauri: () => false,
      tauri: async () => mockTauri(),
    });
    expect(out).toBe("/configs/endpoints.json");
  });

  it("Tauri가 아니면 Tauri API를 절대 부르지 않는다", async () => {
    const api = mockTauri();
    await resolveAssetUrl("/vrms/carlotta.vrm", {
      isTauri: () => false,
      tauri: async () => api,
    });
    expect(api.resolveResource).not.toHaveBeenCalled();
    expect(api.convertFileSrc).not.toHaveBeenCalled();
  });

  it("쿼리스트링이 붙은 경로도 그대로 통과시킨다(dev 캐시버스트 보존)", async () => {
    const out = await resolveAssetUrl("/configs/endpoints.json?t=123", {
      isTauri: () => false,
    });
    expect(out).toBe("/configs/endpoints.json?t=123");
  });
});

describe("resolveAssetUrl — Tauri bundle resolution", () => {
  it("선행 슬래시를 떼고 resolveResource → convertFileSrc로 절대 URL을 만든다", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("/configs/endpoints.json", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(api.resolveResource).toHaveBeenCalledWith("configs/endpoints.json");
    expect(api.convertFileSrc).toHaveBeenCalledWith("/app/resources/configs/endpoints.json");
    expect(out).toBe("asset://localhost/" + encodeURI("/app/resources/configs/endpoints.json"));
  });

  it("VRM 경로도 동일하게 resource-relative로 변환한다", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("/vrms/carlotta.vrm", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(api.resolveResource).toHaveBeenCalledWith("vrms/carlotta.vrm");
    expect(out).toContain("vrms/carlotta.vrm");
  });

  it("reference 경로(유니코드 디렉토리)도 변환한다", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("/references/ナツメ/merged_audio.mp3", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(api.resolveResource).toHaveBeenCalledWith("references/ナツメ/merged_audio.mp3");
    expect(out).toContain(encodeURI("references/ナツメ/merged_audio.mp3"));
  });

  it("쿼리스트링은 변환된 URL 뒤에 보존된다(캐시버스트)", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("/configs/endpoints.json?t=999", {
      isTauri: () => true,
      tauri: async () => api,
    });
    // resolveResource에는 쿼리 없는 경로만 넘긴다.
    expect(api.resolveResource).toHaveBeenCalledWith("configs/endpoints.json");
    expect(out.endsWith("?t=999")).toBe(true);
  });

  it("이미 절대 URL(http/asset)이면 변환 없이 그대로 반환한다", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("https://cdn.example/x.vrm", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(api.resolveResource).not.toHaveBeenCalled();
    expect(out).toBe("https://cdn.example/x.vrm");
  });
});
