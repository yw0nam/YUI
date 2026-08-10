import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAssetUrl } from "./asset-url";
import { fetchReferenceClip, resolveReferenceClipUrl } from "./reference-clip";

vi.mock("./asset-url", () => ({
  resolveAssetUrl: vi.fn(),
}));

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function blobResponse(blob: Blob): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => blob,
  } as Response;
}

beforeEach(() => {
  vi.mocked(resolveAssetUrl).mockImplementation(async (url) => url);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveReferenceClipUrl", () => {
  it("absolutizes a relative browser URL against the current origin", async () => {
    vi.stubGlobal("location", { href: "http://127.0.0.1:1420/settings" });

    await expect(resolveReferenceClipUrl("/references/ayase.mp3")).resolves.toBe(
      "http://127.0.0.1:1420/references/ayase.mp3",
    );
    expect(resolveAssetUrl).toHaveBeenCalledWith("/references/ayase.mp3");
  });

  it("absolutizes the relative URL returned by the asset resolver in Tauri dev", async () => {
    vi.mocked(resolveAssetUrl).mockResolvedValue("/references/natsume.mp3");
    vi.stubGlobal("location", { href: "http://127.0.0.1:1420/" });

    await expect(resolveReferenceClipUrl("/references/natsume.mp3")).resolves.toBe(
      "http://127.0.0.1:1420/references/natsume.mp3",
    );
    expect(resolveAssetUrl).toHaveBeenCalledWith("/references/natsume.mp3");
  });

  it("returns the packaged Tauri asset URL", async () => {
    const assetUrl = "asset://localhost/app/resources/references/ayase.mp3";
    vi.mocked(resolveAssetUrl).mockResolvedValue(assetUrl);
    vi.stubGlobal("location", { href: "tauri://localhost/" });

    await expect(resolveReferenceClipUrl("/references/ayase.mp3")).resolves.toBe(assetUrl);
  });

  it("returns the resolved input when URL construction fails", async () => {
    const invalidUrl = "http://[";
    vi.mocked(resolveAssetUrl).mockResolvedValue(invalidUrl);
    vi.stubGlobal("location", { href: "http://127.0.0.1:1420/" });

    await expect(resolveReferenceClipUrl("/references/broken.mp3")).resolves.toBe(invalidUrl);
  });

  it("returns the resolved input unchanged in a base-less environment", async () => {
    await expect(resolveReferenceClipUrl("/references/natsume.mp3")).resolves.toBe(
      "/references/natsume.mp3",
    );
  });
});

describe("fetchReferenceClip", () => {
  it("uses the global fetch for an asset:// URL", async () => {
    const refUrl = "asset://localhost/app/resources/references/ayase.mp3";
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    const globalFetch = vi.fn<FetchFn>(async () => blobResponse(blob));
    const injectedFetch = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", globalFetch);

    await expect(fetchReferenceClip(refUrl, { fetch: injectedFetch })).resolves.toBe(blob);

    expect(globalFetch).toHaveBeenCalledWith(refUrl);
    expect(injectedFetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1:1420/references/ayase.mp3",
    "https://example.com/references/ayase.mp3",
    "file:///etc/passwd",
    "data:audio/mpeg;base64,AAAA",
    // No ref resolver in this codebase emits a blob: URL — it is not a webview-only scheme here.
    "blob:http://127.0.0.1:1420/35dcac8d-5640-4d23-a135-b9ec56bb9377",
  ])("uses the injected fetch for %s", async (refUrl) => {
    const blob = new Blob([new Uint8Array([4, 5, 6])], { type: "audio/mpeg" });
    const globalFetch = vi.fn<FetchFn>();
    const injectedFetch = vi.fn<FetchFn>(async () => blobResponse(blob));
    vi.stubGlobal("fetch", globalFetch);

    await expect(fetchReferenceClip(refUrl, { fetch: injectedFetch })).resolves.toBe(blob);

    expect(injectedFetch).toHaveBeenCalledWith(refUrl);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("throws the resolved URL and HTTP status when the fetch fails", async () => {
    const refUrl = "https://example.com/references/missing.mp3";
    const injectedFetch = vi.fn<FetchFn>(async () => {
      return { ok: false, status: 404 } as Response;
    });

    await expect(fetchReferenceClip(refUrl, { fetch: injectedFetch })).rejects.toThrow(
      `reference clip fetch failed (HTTP 404) ${refUrl}`,
    );
  });

  it("returns the response blob", async () => {
    const refUrl = "https://example.com/references/ayase.mp3";
    const blob = new Blob([new Uint8Array([7, 8, 9])], { type: "audio/wav" });
    const injectedFetch = vi.fn<FetchFn>(async () => blobResponse(blob));

    await expect(fetchReferenceClip(refUrl, { fetch: injectedFetch })).resolves.toBe(blob);
  });
});
