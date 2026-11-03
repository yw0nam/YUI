/**
 * fish-key-check.test.ts — whether Fish Audio accepts a TTS key.
 *
 * checkFishKey: GET {baseUrl}/model?self=true&page_size=1&page_number=1 with the Bearer key.
 * 2xx → ok; 401/403 → refused; any other status, a thrown request or the 10 s deadline → failed.
 */

import { describe, expect, it, vi } from "vitest";
import { checkFishKey } from "./fish-key-check";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.fish.audio";

describe("checkFishKey", () => {
  it.each<[string, number, "ok" | "refused" | "failed"]>([
    ["200", 200, "ok"],
    ["401, a bad key", 401, "refused"],
    ["403", 403, "refused"],
    ["500", 500, "failed"],
  ])("HTTP %s → %s", async (_, status, expected) => {
    const fetchMock = vi.fn<FetchFn>(async () => new Response("{}", { status }));

    const result = await checkFishKey({ baseUrl: BASE_URL, key: "fish-key", fetch: fetchMock as unknown as typeof fetch });

    expect(result).toBe(expected);
  });

  it("GETs the model endpoint with the Bearer key", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => new Response("{}", { status: 200 }));

    await checkFishKey({ baseUrl: BASE_URL, key: "fish-key", fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE_URL}/model?self=true&page_size=1&page_number=1`);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("Authorization")).toBe(
      "Bearer fish-key",
    );
  });

  it.each<[string, typeof globalThis.fetch]>([
    [
      "a thrown request",
      async () => {
        throw new TypeError("network");
      },
    ],
    [
      "a deadline timeout",
      () => new Promise<Response>(() => {}),
    ],
  ])("%s → failed", async (_, fetchImpl) => {
    vi.useFakeTimers();
    try {
      const pending = checkFishKey({
        baseUrl: BASE_URL,
        key: "fish-key",
        fetch: fetchImpl as unknown as typeof fetch,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });
});
