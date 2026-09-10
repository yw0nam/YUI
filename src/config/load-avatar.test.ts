/**
 * load-avatar.test.ts — unit tests for the loadConfig avatar.* section.
 * available manifest, framing, hit_test, gaze.
 */

import { describe, expect, it } from "vitest";
import { CONFIG_FILES, ConfigError, loadConfig } from "./load";
import { avatarFixture, goodFixture, readerOf } from "./load-test-helpers";

/** rejects → ConfigError on avatar.json with non-empty issues. */
async function expectAvatarError(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(ConfigError);
  const err = await p.catch((e) => e);
  expect((err as ConfigError).file).toBe("avatar.json");
  expect((err as ConfigError).issues.length).toBeGreaterThan(0);
}

/** Loads the good fixture with avatar.json replaced. */
async function loadWithAvatar(avatar: unknown): Promise<Awaited<ReturnType<typeof loadConfig>>> {
  const map = goodFixture();
  map[CONFIG_FILES.avatar] = avatar;
  return loadConfig({ read: readerOf(map) });
}

/** The full avatar fixture with some sections replaced. */
function avatarWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...(avatarFixture() as unknown as Record<string, unknown>), ...overrides };
}

// ── avatar.available manifest (VRM swap) ────────────────────────────────────────

describe("loadConfig — avatar.available", () => {
  it("available가 없으면 vrm_url만 담고 available는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar).toEqual(avatarFixture());
    expect(cfg.avatar.available).toBeUndefined();
  });

  it("available 배열을 순서대로 보존하고 source를 그대로 담는다", async () => {
    const cfg = await loadWithAvatar(
      avatarWith({
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
          { id: "guest", label: "Guest", url: "https://example.com/guest.vrm" },
        ],
      }),
    );
    expect(cfg.avatar.vrm_url).toBe("/vrms/carlotta.vrm");
    expect(cfg.avatar.available).toEqual([
      { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
      { id: "guest", label: "Guest", url: "https://example.com/guest.vrm" },
    ]);
  });

  it("서로 다른 단순 id([A-Za-z0-9._-])는 모두 통과한다", async () => {
    const cfg = await loadWithAvatar(
      avatarWith({
        available: [
          { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm" },
          { id: "guest_2", label: "Guest 2", url: "https://example.com/g2.vrm" },
          { id: "v1.0-final", label: "V1", url: "/vrms/v1.vrm" },
        ],
      }),
    );
    expect(cfg.avatar.available?.map((a) => a.id)).toEqual(["carlotta", "guest_2", "v1.0-final"]);
  });
});

// ── avatar.framing fit-to-bounds ────────────────────────────────────────────────

describe("loadConfig — avatar.framing", () => {
  it("유효한 framing {margin, fov}를 그대로 보존한다", async () => {
    const cfg = await loadWithAvatar(avatarWith({ framing: { margin: 0.2, fov: 45 } }));
    expect(cfg.avatar.framing).toEqual({ margin: 0.2, fov: 45 });
  });

  it("framing이 없으면 실패", async () => {
    const avatar = avatarWith({});
    delete avatar.framing;
    await expectAvatarError(loadWithAvatar(avatar));
  });

  it("fov: 0 (열린구간 밖)이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ framing: { margin: 0.1, fov: 0 } })));
  });

  it("fov: 180 (열린구간 밖)이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ framing: { margin: 0.1, fov: 180 } })));
  });

  it("fov: -5 (음수)이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ framing: { margin: 0.1, fov: -5 } })));
  });

  it('fov: "30" (문자열)이면 실패', async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ framing: { margin: 0.1, fov: "30" } })));
  });

  it("margin: -0.1 (음수)이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ framing: { margin: -0.1, fov: 30 } })));
  });

  it("margin: NaN (비유한)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar(avatarWith({ framing: { margin: Number.NaN, fov: 30 } })),
    );
  });
});

// ── avatar.hit_test click-through ───────────────────────────────────────────────

describe("loadConfig — avatar.hit_test", () => {
  /** The fixture hit_test block with one key replaced. */
  const hitTestWith = (overrides: Record<string, unknown>): Record<string, unknown> =>
    avatarWith({ hit_test: { ...avatarFixture().hit_test, ...overrides } });

  it("유효한 hit_test 전체 블록을 그대로 보존한다", async () => {
    const cfg = await loadWithAvatar(hitTestWith({ poll_interval_ms: 200 }));
    expect(cfg.avatar.hit_test).toEqual({
      hysteresis_margin_px: 8,
      poll_interval_ms: 200,
      debounce_samples: 2,
      alpha_threshold: 0.1,
    });
  });

  it("hit_test이 없으면 실패", async () => {
    const avatar = avatarWith({});
    delete avatar.hit_test;
    await expectAvatarError(loadWithAvatar(avatar));
  });

  it("hit_test 키 하나가 없으면 실패", async () => {
    const hit_test = { ...avatarFixture().hit_test } as Record<string, unknown>;
    delete hit_test.poll_interval_ms;
    await expectAvatarError(loadWithAvatar(avatarWith({ hit_test })));
  });

  it("hit_test이 객체가 아니면 실패", async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ hit_test: 5 })));
  });

  it("hysteresis_margin_px: 음수면 실패", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ hysteresis_margin_px: -1 })));
  });

  it("hysteresis_margin_px: 비유한이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ hysteresis_margin_px: Number.NaN })));
  });

  it("poll_interval_ms: 0 이하면 실패", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ poll_interval_ms: 0 })));
  });

  it("debounce_samples: 정수가 아니면 실패", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ debounce_samples: 1.5 })));
  });

  it("debounce_samples: 1 미만이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ debounce_samples: 0 })));
  });

  it("alpha_threshold: (0,1] 밖이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ alpha_threshold: 1.5 })));
  });
});

// ── avatar.gaze camera tracking ─────────────────────────────────────────────────

describe("loadConfig — avatar.gaze", () => {
  /** The fixture gaze block with one key replaced. */
  const gazeWith = (overrides: Record<string, unknown>): Record<string, unknown> =>
    avatarWith({ gaze: { ...avatarFixture().gaze, ...overrides } });

  it("유효한 gaze 전체 블록을 그대로 보존한다", async () => {
    const fullGaze = {
      deadDeg: 3,
      headEngageDeg: 20,
      disengageDeg: 65,
      sensitivity: 40,
      maxHeadYaw: 50,
      maxHeadPitch: 30,
      eyeMaxDeg: 25,
      headNeckSplit: 0.6,
      smooth: 10,
    };
    const cfg = await loadWithAvatar(avatarWith({ gaze: fullGaze }));
    expect(cfg.avatar.gaze).toEqual(fullGaze);
  });

  it("gaze가 없으면 실패", async () => {
    const avatar = avatarWith({});
    delete avatar.gaze;
    await expectAvatarError(loadWithAvatar(avatar));
  });

  it("gaze 키 하나가 없으면 실패", async () => {
    const gaze = { ...avatarFixture().gaze } as Record<string, unknown>;
    delete gaze.disengageDeg;
    await expectAvatarError(loadWithAvatar(avatarWith({ gaze })));
  });

  it("gaze가 객체가 아니면 실패", async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ gaze: 5 })));
  });

  it("deadDeg 음수면 실패", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ deadDeg: -1 })));
  });

  it("disengageDeg > 180이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ disengageDeg: 181 })));
  });

  it("eyeMaxDeg > 90이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ eyeMaxDeg: 91 })));
  });

  it("headNeckSplit이 [0,1] 밖이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ headNeckSplit: 1.2 })));
  });

  it("smooth가 0 이하면 실패", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ smooth: 0 })));
  });

  it("maxHeadYaw가 NaN이면 실패", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ maxHeadYaw: Number.NaN })));
  });
});
