/**
 * load-avatar.test.ts — unit tests for the loadConfig avatar.* section.
 * available manifest, framing, hit_test, gaze.
 */

import { describe, expect, it } from "vitest";
import { CONFIG_FILES, ConfigError, loadConfig } from "./load";
import { goodFixture, readerOf } from "./load-test-helpers";

// ── avatar.available manifest (VRM swap) ────────────────────────────────────────

describe("loadConfig — avatar.available", () => {
  it("available가 없으면 vrm_url만 담고 available는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar).toEqual({
      vrm_url: "/vrms/carlotta.vrm",
      peek: {
        side_out_frac: 0.28,
        side_in_frac: 0.23,
        inset_frac: 0.12,
        mirror_side: "right",
      },
      tap: {
        spam_count: 4,
        spam_window_ms: 3000,
        region_radius_frac: 0.18,
        region_motions: { head: "head_pat", chest: "embarrassed", hips: "embarrassed" },
        bored_cue: { label: "bored poking" },
        touch_cue_cooldown_ms: 60_000,
        touch_emotion_hold_ms: 4000,
        pat_hold_ms: 300,
      },
      drag_hold_ms: 5000,
      gesture_cues: {
        drag_held: { label: "dragged around" },
        window_sit: { label: "sat on window" },
        peek: { label: "peeking" },
        dropped: { label: "dropped from mid-air" },
      },
      walk: {
        interval_min_ms: 30_000,
        interval_max_ms: 60_000,
        distance_min_px: 200,
        distance_max_px: 600,
        floor_tolerance_px: 24,
      },
      perch_walk: {
        dwell_min_ms: 45_000,
        dwell_max_ms: 120_000,
        distance_min_px: 80,
        distance_max_px: 400,
        edge_margin_frac: 0.2,
        level_tolerance_px: 8,
      },
      fall: {
        gravity_px_s2: 1600,
        max_speed_px_s: 1200,
        min_drop_frac: 0.2,
        cue_cooldown_ms: 60_000,
        land_room_frac: 0.5,
        step_off_probability: 0.1,
      },
      climb: {
        interval_min_ms: 90_000,
        interval_max_ms: 180_000,
        perch_dwell_min_ms: 60_000,
        perch_dwell_max_ms: 120_000,
        max_height_frac: 4,
        hang_frac: 0.3,
        wall_offset_frac: 0.3,
        ledge_walk_min_frac: 0.5,
        ledge_walk_max_frac: 1.5,
      },
      jump: {
        probability: 0.3,
        height_up_max_frac: 0.5,
        height_down_max_frac: 1,
        gap_max_width_frac: 1.5,
        apex_lift_frac: 0.15,
        takeoff_frac: 0.4,
        land_frac: 0.67,
        flight_timeout_ms: 4000,
      },
    });
    expect(cfg.avatar.available).toBeUndefined();
  });

  it("유효한 available[]를 그대로 보존한다(source 포함/생략 모두)", async () => {
    const map = goodFixture();
    map["avatar.json"] = {
      vrm_url: "/vrms/carlotta.vrm",
      available: [
        { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
        { id: "guest", label: "Guest", url: "https://example.com/guest.vrm" },
      ],
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.avatar.vrm_url).toBe("/vrms/carlotta.vrm");
    expect(cfg.avatar.available).toEqual([
      { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
      { id: "guest", label: "Guest", url: "https://example.com/guest.vrm" },
    ]);
  });

  it("서로 다른 단순 id([A-Za-z0-9._-])는 모두 통과한다", async () => {
    const map = goodFixture();
    map["avatar.json"] = {
      vrm_url: "/vrms/carlotta.vrm",
      available: [
        { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm" },
        { id: "guest_2", label: "Guest 2", url: "https://example.com/g2.vrm" },
        { id: "v1.0-final", label: "V1", url: "/vrms/v1.vrm" },
      ],
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.avatar.available?.map((a) => a.id)).toEqual(["carlotta", "guest_2", "v1.0-final"]);
  });
});

// ── avatar.framing fit-to-bounds ────────────────────────────────────────────────

describe("loadConfig — avatar.framing", () => {
  /** rejects → ConfigError on avatar.json with non-empty issues. */
  async function expectAvatarError(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("avatar.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }
  async function loadWithAvatar(avatar: unknown): Promise<unknown> {
    const map = goodFixture();
    map[CONFIG_FILES.avatar] = avatar;
    return loadConfig({ read: readerOf(map) });
  }

  it("유효한 framing {margin, fov}를 그대로 보존한다", async () => {
    const cfg = await loadConfig({
      read: readerOf({
        ...goodFixture(),
        "avatar.json": { vrm_url: "/vrms/carlotta.vrm", framing: { margin: 0.1, fov: 30 } },
      }),
    });
    expect(cfg.avatar.framing).toEqual({ margin: 0.1, fov: 30 });
  });

  it("framing이 없으면 undefined (하위호환)", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar.framing).toBeUndefined();
  });

  it("fov: 0 (열린구간 밖)이면 실패", async () => {
    await expectAvatarError(loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: 0 } }));
  });

  it("fov: 180 (열린구간 밖)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: 180 } }),
    );
  });

  it("fov: -5 (음수)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: -5 } }),
    );
  });

  it('fov: "30" (문자열)이면 실패', async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { fov: "30" } }),
    );
  });

  it("margin: -0.1 (음수)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { margin: -0.1 } }),
    );
  });

  it("margin: NaN (비유한)이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", framing: { margin: Number.NaN } }),
    );
  });
});

// ── avatar.hit_test click-through ───────────────────────────────────────────────

describe("loadConfig — avatar.hit_test", () => {
  async function expectAvatarError(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("avatar.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }
  async function loadWithAvatar(avatar: unknown): Promise<Awaited<ReturnType<typeof loadConfig>>> {
    const map = goodFixture();
    map[CONFIG_FILES.avatar] = avatar;
    return loadConfig({ read: readerOf(map) });
  }

  it("유효한 hit_test 전체 블록을 그대로 보존한다", async () => {
    const cfg = await loadWithAvatar({
      vrm_url: "/vrms/carlotta.vrm",
      hit_test: {
        hysteresis_margin_px: 8,
        poll_interval_ms: 200,
        debounce_samples: 2,
        alpha_threshold: 0.1,
      },
    });
    expect(cfg.avatar.hit_test).toEqual({
      hysteresis_margin_px: 8,
      poll_interval_ms: 200,
      debounce_samples: 2,
      alpha_threshold: 0.1,
    });
  });

  it("hit_test이 없으면 undefined (하위호환)", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar.hit_test).toBeUndefined();
  });

  it("부분 hit_test(일부 필드만)도 허용한다", async () => {
    const cfg = await loadWithAvatar({
      vrm_url: "/vrms/carlotta.vrm",
      hit_test: { poll_interval_ms: 150 },
    });
    expect(cfg.avatar.hit_test).toEqual({ poll_interval_ms: 150 });
  });

  it("hit_test이 객체가 아니면 실패", async () => {
    await expectAvatarError(loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: 5 }));
  });

  it("hysteresis_margin_px: 음수면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { hysteresis_margin_px: -1 } }),
    );
  });

  it("hysteresis_margin_px: 비유한이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({
        vrm_url: "/vrms/carlotta.vrm",
        hit_test: { hysteresis_margin_px: Number.NaN },
      }),
    );
  });

  it("poll_interval_ms: 0 이하면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { poll_interval_ms: 0 } }),
    );
  });

  it("debounce_samples: 정수가 아니면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { debounce_samples: 1.5 } }),
    );
  });

  it("debounce_samples: 1 미만이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { debounce_samples: 0 } }),
    );
  });

  it("alpha_threshold: (0,1] 밖이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", hit_test: { alpha_threshold: 1.5 } }),
    );
  });
});

// ── avatar.gaze camera tracking ─────────────────────────────────────────────────

describe("loadConfig — avatar.gaze", () => {
  async function expectAvatarError(p: Promise<unknown>): Promise<void> {
    await expect(p).rejects.toBeInstanceOf(ConfigError);
    const err = await p.catch((e) => e);
    expect((err as ConfigError).file).toBe("avatar.json");
    expect((err as ConfigError).issues.length).toBeGreaterThan(0);
  }
  async function loadWithAvatar(avatar: unknown): Promise<unknown> {
    const map = goodFixture();
    map[CONFIG_FILES.avatar] = avatar;
    return loadConfig({ read: readerOf(map) });
  }

  const fullGaze = {
    deadDeg: 3,
    headEngageDeg: 20,
    disengageDeg: 65,
    maxHeadYaw: 50,
    maxHeadPitch: 30,
    eyeMaxDeg: 25,
    headNeckSplit: 0.6,
    smooth: 10,
  };

  it("유효한 gaze 전체 블록을 그대로 보존한다", async () => {
    const cfg = await loadConfig({
      read: readerOf({
        ...goodFixture(),
        "avatar.json": { vrm_url: "/vrms/carlotta.vrm", gaze: fullGaze },
      }),
    });
    expect(cfg.avatar.gaze).toEqual(fullGaze);
  });

  it("gaze가 없으면 undefined (하위호환 → 렌더러 기본값)", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.avatar.gaze).toBeUndefined();
  });

  it("부분 gaze(일부 필드만)도 허용한다", async () => {
    const cfg = await loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { disengageDeg: 70 } });
    expect((cfg as { avatar: { gaze?: unknown } }).avatar.gaze).toEqual({ disengageDeg: 70 });
  });

  it("gaze가 객체가 아니면 실패", async () => {
    await expectAvatarError(loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: 5 }));
  });

  it("deadDeg 음수면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { deadDeg: -1 } }),
    );
  });

  it("disengageDeg > 180이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { disengageDeg: 181 } }),
    );
  });

  it("eyeMaxDeg > 90이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { eyeMaxDeg: 91 } }),
    );
  });

  it("headNeckSplit이 [0,1] 밖이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { headNeckSplit: 1.2 } }),
    );
  });

  it("smooth가 0 이하면 실패", async () => {
    await expectAvatarError(loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { smooth: 0 } }));
  });

  it("maxHeadYaw가 NaN이면 실패", async () => {
    await expectAvatarError(
      loadWithAvatar({ vrm_url: "/vrms/carlotta.vrm", gaze: { maxHeadYaw: Number.NaN } }),
    );
  });
});
