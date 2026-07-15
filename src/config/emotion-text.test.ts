/**
 * emotion-text.test.ts — loadEmotionTextTable unit tests + irodori table drift-guard.
 *
 * Principle: loader tests inject a fake ConfigReader (`read`) and validate in-memory only.
 * Only the drift-guard is an exception — it reads the real artifacts via Node fs (configs/emotion_text/irodori.json ↔
 * docs/reference/tts-emotion/irodori.md) and asserts the key sets match (guards against edit drift).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEmotionTextTable } from "./emotion-text";
import { ConfigError, type ConfigReader } from "./load";

const REPO_ROOT = resolve(__dirname, "../..");

function readerOf(map: Record<string, unknown>): ConfigReader {
  return async (file) => {
    if (!(file in map)) throw new Error(`fake reader: missing ${file}`);
    return map[file];
  };
}

// ── loader happy path ────────────────────────────────────────────────────────

describe("loadEmotionTextTable — happy path", () => {
  it("provider 파일을 읽어 Record<string,string>로 반환한다", async () => {
    const table = { "👂": "Whisper", "😮‍💨": "Breath, sigh" };
    const out = await loadEmotionTextTable({
      provider: "irodori",
      read: readerOf({ "emotion_text/irodori.json": table }),
    });
    expect(out).toEqual(table);
  });

  it("provider별 파일명을 읽는다(<provider>.json)", async () => {
    const table = { "😀": "Grin" };
    let requested = "";
    const out = await loadEmotionTextTable({
      provider: "fishspeech",
      read: async (file) => {
        requested = file;
        return table;
      },
    });
    expect(requested).toBe("emotion_text/fishspeech.json");
    expect(out).toEqual(table);
  });
});

// ── loader fail-loud ─────────────────────────────────────────────────────────

describe("loadEmotionTextTable — fail-loud ConfigError", () => {
  async function expectError(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("emotion_text/irodori.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }

  it("객체가 아니면 실패", async () => {
    await expectError(
      loadEmotionTextTable({
        provider: "irodori",
        read: readerOf({ "emotion_text/irodori.json": ["👂"] }),
      }),
    );
  });

  it("빈 객체면 실패", async () => {
    await expectError(
      loadEmotionTextTable({
        provider: "irodori",
        read: readerOf({ "emotion_text/irodori.json": {} }),
      }),
    );
  });

  it("값이 문자열이 아니면 실패", async () => {
    await expectError(
      loadEmotionTextTable({
        provider: "irodori",
        read: readerOf({ "emotion_text/irodori.json": { "👂": 1 } }),
      }),
    );
  });
});

// ── default fetch reader: asset-url resolver wiring ───────────────────────────

describe("loadEmotionTextTable — default fetch reader routes through asset resolver", () => {
  it("dev(passthrough resolver)는 baseUrl/파일 URL 그대로 fetch한다", async () => {
    let fetched = "";
    const fetchMock = async (url: string) => {
      fetched = url;
      return { ok: true, json: async () => ({ "👂": "Whisper" }) } as unknown as Response;
    };
    const out = await loadEmotionTextTable({
      provider: "irodori",
      baseUrl: "/configs",
      fetch: fetchMock as unknown as typeof fetch,
      resolveUrl: async (p) => p,
    });
    expect(fetched).toBe("/configs/emotion_text/irodori.json");
    expect(out).toEqual({ "👂": "Whisper" });
  });

  it("Tauri(변환 resolver)는 변환된 URL로 fetch한다", async () => {
    let fetched = "";
    const fetchMock = async (url: string) => {
      fetched = url;
      return { ok: true, json: async () => ({ "👂": "Whisper" }) } as unknown as Response;
    };
    await loadEmotionTextTable({
      provider: "irodori",
      baseUrl: "/configs",
      fetch: fetchMock as unknown as typeof fetch,
      resolveUrl: async (p) => `asset://localhost${p}`,
    });
    expect(fetched).toBe("asset://localhost/configs/emotion_text/irodori.json");
  });
});

// ── drift-guard: configs JSON keys ↔ docs md emoji set ───────────────────────

describe("irodori emotion_text drift-guard", () => {
  /** Extracts the first-column emoji from the Emoji table in docs/reference/tts-emotion/irodori.md. */
  function emojiFromMarkdown(md: string): string[] {
    const lines = md.split("\n");
    const start = lines.findIndex((l) => l.startsWith("## Emoji table"));
    const out: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## ")) break;
      if (!line.startsWith("|")) continue;
      if (line.startsWith("|---") || line.startsWith("| Emoji")) continue;
      const first = line.split("|")[1]?.trim();
      if (first) out.push(first);
    }
    return out;
  }

  it("JSON 키 집합 === md 이모지 집합 (정확히 39, 누락/잉여 없음)", () => {
    const json = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "configs/emotion_text/irodori.json"), "utf8"),
    ) as Record<string, string>;
    const md = readFileSync(resolve(REPO_ROOT, "docs/reference/tts-emotion/irodori.md"), "utf8");

    const jsonKeys = new Set(Object.keys(json));
    const mdEmoji = new Set(emojiFromMarkdown(md));

    expect(mdEmoji.size).toBe(39);
    expect(jsonKeys.size).toBe(39);
    expect([...jsonKeys].sort()).toEqual([...mdEmoji].sort());
  });
});
