/**
 * load-avatar.test.ts — unit tests for the loadConfig avatar.* section.
 * available manifest, framing, hit_test, gaze.
 */

import { describe, expect, it } from "vitest";
import { CONFIG_FILES, loadConfig } from "./load";
import { avatarFixture, goodFixture, readerOf } from "./load-test-helpers";
import { ConfigError } from "./validators/shared";

/** rejects → ConfigError on avatar.json with non-empty issues. */
async function expectAvatarError(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(ConfigError);
  const err = await p.catch((e) => e);
  expect((err as ConfigError).file).toBe("avatar.json");
  expect((err as ConfigError).issues.length).toBeGreaterThan(0);
}

const UPPER_BODY = { from_frac: 0.4, to_frac: 1 };

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
  it("carries only vrm_url and leaves available undefined when available is missing", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar).toEqual(avatarFixture());
    expect(cfg.avatar.available).toBeUndefined();
  });

  it("preserves the available array order and carries source as-is", async () => {
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

  it("distinct simple ids ([A-Za-z0-9._-]) all pass", async () => {
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
  it("preserves a valid framing {margin, fov} as-is", async () => {
    const cfg = await loadWithAvatar(
      avatarWith({ framing: { margin: 0.2, fov: 45, upper_body: UPPER_BODY } }),
    );
    expect(cfg.avatar.framing).toEqual({ margin: 0.2, fov: 45, upper_body: UPPER_BODY });
  });

  it("fails when framing is missing", async () => {
    const avatar = avatarWith({});
    delete avatar.framing;
    await expectAvatarError(loadWithAvatar(avatar));
  });

  it("fails on fov: 0 (outside the open interval)", async () => {
    await expectAvatarError(
      loadWithAvatar(avatarWith({ framing: { margin: 0.1, fov: 0, upper_body: UPPER_BODY } })),
    );
  });

  it("fails on fov: 180 (outside the open interval)", async () => {
    await expectAvatarError(
      loadWithAvatar(avatarWith({ framing: { margin: 0.1, fov: 180, upper_body: UPPER_BODY } })),
    );
  });

  it("fails on fov: -5 (negative)", async () => {
    await expectAvatarError(
      loadWithAvatar(avatarWith({ framing: { margin: 0.1, fov: -5, upper_body: UPPER_BODY } })),
    );
  });

  it('fails on fov: "30" (string)', async () => {
    await expectAvatarError(
      loadWithAvatar(avatarWith({ framing: { margin: 0.1, fov: "30", upper_body: UPPER_BODY } })),
    );
  });

  it("fails on margin: -0.1 (negative)", async () => {
    await expectAvatarError(
      loadWithAvatar(avatarWith({ framing: { margin: -0.1, fov: 30, upper_body: UPPER_BODY } })),
    );
  });

  it("fails on margin: NaN (non-finite)", async () => {
    await expectAvatarError(
      loadWithAvatar(
        avatarWith({ framing: { margin: Number.NaN, fov: 30, upper_body: UPPER_BODY } }),
      ),
    );
  });
});

// ── avatar.hit_test click-through ───────────────────────────────────────────────

describe("loadConfig — avatar.hit_test", () => {
  /** The fixture hit_test block with one key replaced. */
  const hitTestWith = (overrides: Record<string, unknown>): Record<string, unknown> =>
    avatarWith({ hit_test: { ...avatarFixture().hit_test, ...overrides } });

  it("preserves a valid full hit_test block as-is", async () => {
    const cfg = await loadWithAvatar(hitTestWith({ poll_interval_ms: 200 }));
    expect(cfg.avatar.hit_test).toEqual({
      hysteresis_margin_px: 8,
      poll_interval_ms: 200,
      debounce_samples: 2,
      alpha_threshold: 0.1,
    });
  });

  it("fails when hit_test is missing", async () => {
    const avatar = avatarWith({});
    delete avatar.hit_test;
    await expectAvatarError(loadWithAvatar(avatar));
  });

  it("fails when one hit_test key is missing", async () => {
    const hit_test = { ...avatarFixture().hit_test } as Record<string, unknown>;
    delete hit_test.poll_interval_ms;
    await expectAvatarError(loadWithAvatar(avatarWith({ hit_test })));
  });

  it("fails when hit_test is not an object", async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ hit_test: 5 })));
  });

  it("fails on negative hysteresis_margin_px", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ hysteresis_margin_px: -1 })));
  });

  it("fails on non-finite hysteresis_margin_px", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ hysteresis_margin_px: Number.NaN })));
  });

  it("fails on poll_interval_ms of 0 or less", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ poll_interval_ms: 0 })));
  });

  it("fails when debounce_samples is not an integer", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ debounce_samples: 1.5 })));
  });

  it("fails on debounce_samples below 1", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ debounce_samples: 0 })));
  });

  it("fails on alpha_threshold outside (0,1]", async () => {
    await expectAvatarError(loadWithAvatar(hitTestWith({ alpha_threshold: 1.5 })));
  });
});

// ── avatar.gaze camera tracking ─────────────────────────────────────────────────

describe("loadConfig — avatar.gaze", () => {
  /** The fixture gaze block with one key replaced. */
  const gazeWith = (overrides: Record<string, unknown>): Record<string, unknown> =>
    avatarWith({ gaze: { ...avatarFixture().gaze, ...overrides } });

  it("preserves a valid full gaze block as-is", async () => {
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

  it("fails when gaze is missing", async () => {
    const avatar = avatarWith({});
    delete avatar.gaze;
    await expectAvatarError(loadWithAvatar(avatar));
  });

  it("fails when one gaze key is missing", async () => {
    const gaze = { ...avatarFixture().gaze } as Record<string, unknown>;
    delete gaze.disengageDeg;
    await expectAvatarError(loadWithAvatar(avatarWith({ gaze })));
  });

  it("fails when gaze is not an object", async () => {
    await expectAvatarError(loadWithAvatar(avatarWith({ gaze: 5 })));
  });

  it("fails on negative deadDeg", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ deadDeg: -1 })));
  });

  it("fails on disengageDeg > 180", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ disengageDeg: 181 })));
  });

  it("fails on eyeMaxDeg > 90", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ eyeMaxDeg: 91 })));
  });

  it("fails when headNeckSplit is outside [0,1]", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ headNeckSplit: 1.2 })));
  });

  it("fails on smooth of 0 or less", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ smooth: 0 })));
  });

  it("fails when maxHeadYaw is NaN", async () => {
    await expectAvatarError(loadWithAvatar(gazeWith({ maxHeadYaw: Number.NaN })));
  });
});
