/**
 * emotion-text.test.ts — loadEmotionTextTable 단위 테스트 + irodori 테이블 drift-guard.
 *
 * 원칙: loader 테스트는 fake ConfigReader(`read`)를 주입해 in-memory로만 검증한다.
 * drift-guard만 예외적으로 Node fs로 실제 아티팩트(configs/emotion_text/irodori.json ↔
 * docs/tts_emotion/irodori.md)를 읽어 키 집합 일치를 단언한다(편집 drift 방지).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
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

// ── drift-guard: configs JSON keys ↔ docs md emoji set ───────────────────────

describe("irodori emotion_text drift-guard", () => {
  /** docs/tts_emotion/irodori.md의 Emoji table에서 첫 컬럼 이모지를 추출. */
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
    const md = readFileSync(resolve(REPO_ROOT, "docs/tts_emotion/irodori.md"), "utf8");

    const jsonKeys = new Set(Object.keys(json));
    const mdEmoji = new Set(emojiFromMarkdown(md));

    expect(mdEmoji.size).toBe(39);
    expect(jsonKeys.size).toBe(39);
    expect([...jsonKeys].sort()).toEqual([...mdEmoji].sort());
  });
});
