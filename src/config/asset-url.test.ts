/**
 * asset-url.test.ts — unit tests for the logical asset path → runtime URL resolver.
 *
 * dev/browser (no __TAURI_INTERNALS__) passes the input path through as-is (preserving vite serving),
 * while Tauri packaging builds a bundled-resource absolute URL via resolveResource + convertFileSrc.
 * The Tauri API is injectable — branches are verified with a mock instead of hitting the real @tauri-apps/api.
 */

import { describe, expect, it, vi } from "vitest";
import { resolveAssetUrl, resolveUserFileSrc, type TauriAssetApi } from "./asset-url";

/** Mock imitating bundle-resource paths — resolveResource yields an absolute fs path, convertFileSrc an asset URL. */
function mockTauri(): TauriAssetApi {
  return {
    resolveResource: vi.fn(async (p: string) => `/app/resources/${p}`),
    convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURI(p)}`),
  };
}

describe("resolveAssetUrl — dev/browser passthrough", () => {
  it("returns the input path as-is when not in Tauri", async () => {
    const out = await resolveAssetUrl("/configs/endpoints.json", {
      isTauri: () => false,
      tauri: async () => mockTauri(),
    });
    expect(out).toBe("/configs/endpoints.json");
  });

  it("never calls the Tauri API when not in Tauri", async () => {
    const api = mockTauri();
    await resolveAssetUrl("/vrms/carlotta.vrm", {
      isTauri: () => false,
      tauri: async () => api,
    });
    expect(api.resolveResource).not.toHaveBeenCalled();
    expect(api.convertFileSrc).not.toHaveBeenCalled();
  });

  it("passes a path with a query string through as-is (dev cache-bust preserved)", async () => {
    const out = await resolveAssetUrl("/configs/endpoints.json?t=123", {
      isTauri: () => false,
    });
    expect(out).toBe("/configs/endpoints.json?t=123");
  });
});

describe("resolveAssetUrl — Tauri bundle resolution", () => {
  it("strips the leading slash and builds an absolute URL via resolveResource → convertFileSrc", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("/configs/endpoints.json", {
      isTauri: () => true,
      isDev: () => false,
      tauri: async () => api,
    });
    expect(api.resolveResource).toHaveBeenCalledWith("configs/endpoints.json");
    expect(api.convertFileSrc).toHaveBeenCalledWith("/app/resources/configs/endpoints.json");
    expect(out).toBe(`asset://localhost/${encodeURI("/app/resources/configs/endpoints.json")}`);
  });

  it("converts a VRM path resource-relative the same way", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("/vrms/carlotta.vrm", {
      isTauri: () => true,
      isDev: () => false,
      tauri: async () => api,
    });
    expect(api.resolveResource).toHaveBeenCalledWith("vrms/carlotta.vrm");
    expect(out).toContain("vrms/carlotta.vrm");
  });

  it("converts a reference path (unicode directory) too", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("/references/ナツメ/merged_audio.mp3", {
      isTauri: () => true,
      isDev: () => false,
      tauri: async () => api,
    });
    expect(api.resolveResource).toHaveBeenCalledWith("references/ナツメ/merged_audio.mp3");
    expect(out).toContain(encodeURI("references/ナツメ/merged_audio.mp3"));
  });

  it("preserves the query string after the converted URL (cache-bust)", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("/configs/endpoints.json?t=999", {
      isTauri: () => true,
      isDev: () => false,
      tauri: async () => api,
    });
    // Only the query-less path is passed to resolveResource.
    expect(api.resolveResource).toHaveBeenCalledWith("configs/endpoints.json");
    expect(out.endsWith("?t=999")).toBe(true);
  });

  it("returns an already-absolute URL (http/asset) as-is without converting", async () => {
    const api = mockTauri();
    const out = await resolveAssetUrl("https://cdn.example/x.vrm", {
      isTauri: () => true,
      isDev: () => false,
      tauri: async () => api,
    });
    expect(api.resolveResource).not.toHaveBeenCalled();
    expect(out).toBe("https://cdn.example/x.vrm");
  });
});

describe("resolveAssetUrl — dev-Tauri live-serving bypass", () => {
  it("returns the input path as-is even in Tauri when dev (vite live serving → hot reload)", async () => {
    const out = await resolveAssetUrl("/configs/hotkeys.json", {
      isTauri: () => true,
      isDev: () => true,
      tauri: async () => mockTauri(),
    });
    expect(out).toBe("/configs/hotkeys.json");
  });

  it("does not call resolveResource/convertFileSrc in dev (never touches the bundled copy)", async () => {
    const api = mockTauri();
    await resolveAssetUrl("/vrms/carlotta.vrm", {
      isTauri: () => true,
      isDev: () => true,
      tauri: async () => api,
    });
    expect(api.resolveResource).not.toHaveBeenCalled();
    expect(api.convertFileSrc).not.toHaveBeenCalled();
  });

  it("preserves the cache-bust query on the dev bypass too", async () => {
    const out = await resolveAssetUrl("/configs/hotkeys.json?t=123", {
      isTauri: () => true,
      isDev: () => true,
    });
    expect(out).toBe("/configs/hotkeys.json?t=123");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveUserFileSrc — imported app-data absolute file path → webview URL
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveUserFileSrc — Tauri app-data absolute path", () => {
  it("turns an absolute fs path into a webview URL via convertFileSrc (no resolveResource)", async () => {
    const api = mockTauri();
    const out = await resolveUserFileSrc("/Users/me/Library/.../com.yui/vrms/Cat.vrm", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(api.resolveResource).not.toHaveBeenCalled();
    expect(api.convertFileSrc).toHaveBeenCalledWith("/Users/me/Library/.../com.yui/vrms/Cat.vrm");
    expect(out).toBe(
      `asset://localhost/${encodeURI("/Users/me/Library/.../com.yui/vrms/Cat.vrm")}`,
    );
  });

  it("takes a different conversion path than resource-relative paths (resolveResource)", async () => {
    const api = mockTauri();
    const resourceOut = await resolveAssetUrl("/vrms/carlotta.vrm", {
      isTauri: () => true,
      isDev: () => false,
      tauri: async () => api,
    });
    const userOut = await resolveUserFileSrc("/abs/app-data/vrms/Cat.vrm", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(resourceOut).toContain("/app/resources/");
    expect(userOut).not.toContain("/app/resources/");
  });

  it("passes an already-asset:// URL through as-is (no re-conversion)", async () => {
    const api = mockTauri();
    const out = await resolveUserFileSrc("asset://localhost/x.vrm", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(api.convertFileSrc).not.toHaveBeenCalled();
    expect(out).toBe("asset://localhost/x.vrm");
  });

  it("passes the input path through as-is in dev/browser (non-Tauri)", async () => {
    const api = mockTauri();
    const out = await resolveUserFileSrc("/abs/whatever.vrm", {
      isTauri: () => false,
      tauri: async () => api,
    });
    expect(api.convertFileSrc).not.toHaveBeenCalled();
    expect(out).toBe("/abs/whatever.vrm");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveUserFileSrc — scheme allowlist (block dangerous schemes)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveUserFileSrc — scheme allowlist", () => {
  // Dangerous schemes must NOT pass through as a usable asset src.
  for (const scheme of ["javascript:", "data:", "file:", "vbscript:", "JavaScript:", "DATA:"]) {
    it(`blocks ${scheme} — does not return it verbatim (returns empty)`, async () => {
      const api = mockTauri();
      const evil = `${scheme}alert(1)`;
      const out = await resolveUserFileSrc(evil, { isTauri: () => true, tauri: async () => api });
      expect(out).not.toBe(evil);
      expect(out).toBe("");
      expect(api.convertFileSrc).not.toHaveBeenCalled();
    });

    it(`blocks ${scheme} even in dev/browser (non-Tauri)`, async () => {
      const api = mockTauri();
      const evil = `${scheme}alert(1)`;
      const out = await resolveUserFileSrc(evil, { isTauri: () => false, tauri: async () => api });
      expect(out).not.toBe(evil);
      expect(out).toBe("");
    });
  }

  it("passes through legitimate asset:// / blob: / http(s) inputs verbatim", async () => {
    const api = mockTauri();
    for (const ok of [
      "asset://localhost/x.vrm",
      "blob:https://app/abc",
      "https://cdn.example/x.vrm",
      "http://localhost/x.vrm",
    ]) {
      const out = await resolveUserFileSrc(ok, { isTauri: () => true, tauri: async () => api });
      expect(out).toBe(ok);
    }
    expect(api.convertFileSrc).not.toHaveBeenCalled();
  });

  it("converts a bare absolute filesystem path via convertFileSrc (Tauri)", async () => {
    const api = mockTauri();
    const out = await resolveUserFileSrc("/abs/app-data/vrms/Cat.vrm", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(api.convertFileSrc).toHaveBeenCalledWith("/abs/app-data/vrms/Cat.vrm");
    expect(out).toBe(`asset://localhost/${encodeURI("/abs/app-data/vrms/Cat.vrm")}`);
  });

  it("converts a Windows drive path via convertFileSrc, not scheme passthrough (Tauri)", async () => {
    const api = mockTauri();
    const out = await resolveUserFileSrc("C:\\Users\\me\\Cat.vrm", {
      isTauri: () => true,
      tauri: async () => api,
    });
    expect(api.convertFileSrc).toHaveBeenCalledWith("C:\\Users\\me\\Cat.vrm");
    expect(out).not.toBe("C:\\Users\\me\\Cat.vrm");
  });
});
