import { describe, expect, it } from "vitest";
import { validateAvatar } from "./avatar";
import { ConfigError } from "./shared";

const FILE = "avatar.json";

function expectIssue(raw: unknown, fragment: string): void {
  try {
    validateAvatar(FILE, raw);
    expect.unreachable("validateAvatar should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    const err = e as ConfigError;
    expect(err.file).toBe(FILE);
    expect(
      err.issues.some((i) => i.includes(fragment)),
      err.issues.join("; "),
    ).toBe(true);
  }
}

describe("validateAvatar — happy path", () => {
  it("accepts a bare vrm_url", () => {
    const out = validateAvatar(FILE, { vrm_url: "/vrms/carlotta.vrm" });
    expect(out).toEqual({ vrm_url: "/vrms/carlotta.vrm" });
  });

  it("accepts an available[] manifest with distinct ids", () => {
    const raw = {
      vrm_url: "/vrms/carlotta.vrm",
      available: [
        { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
        { id: "custom.1", label: "Custom", url: "/vrms/custom.vrm", source: "user" },
      ],
    };
    const out = validateAvatar(FILE, raw);
    expect(out.available).toEqual(raw.available);
  });

  it("accepts partial framing/hit_test/gaze knobs", () => {
    const raw = {
      vrm_url: "/vrms/carlotta.vrm",
      framing: { margin: 0.1, fov: 30 },
      hit_test: {
        hysteresis_margin_px: 4,
        poll_interval_ms: 100,
        debounce_samples: 2,
        alpha_threshold: 0.5,
      },
      gaze: {
        deadDeg: 0,
        headEngageDeg: 10,
        disengageDeg: 15,
        maxHeadYaw: 45,
        maxHeadPitch: 20,
        eyeMaxDeg: 15,
        headNeckSplit: 0.6,
        smooth: 120,
      },
    };
    const out = validateAvatar(FILE, raw);
    expect(out.framing).toEqual(raw.framing);
    expect(out.hit_test).toEqual(raw.hit_test);
    expect(out.gaze).toEqual(raw.gaze);
  });
});

describe("validateAvatar — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "객체가 아님");
    expectIssue("x", "객체가 아님");
    expectIssue(null, "객체가 아님");
  });

  it("rejects a missing vrm_url", () => {
    expectIssue({}, "vrm_url은 비어 있지 않은 문자열이어야 함");
  });

  it("rejects an empty vrm_url", () => {
    expectIssue({ vrm_url: "" }, "vrm_url은 비어 있지 않은 문자열이어야 함");
  });

  it("rejects a non-string vrm_url", () => {
    expectIssue({ vrm_url: 1 }, "vrm_url은 비어 있지 않은 문자열이어야 함");
  });
});

describe("validateAvatar — available[]", () => {
  it("rejects available that isn't an array", () => {
    expectIssue({ vrm_url: "/v.vrm", available: "nope" }, "available은 배열이어야 함");
  });

  it("rejects a non-object entry", () => {
    expectIssue({ vrm_url: "/v.vrm", available: ["nope"] }, "available[0]: 항목이 객체가 아님");
  });

  it("rejects an entry missing id/label/url", () => {
    expectIssue(
      { vrm_url: "/v.vrm", available: [{ id: "a" }] },
      "available[0].label는 비어 있지 않은 문자열이어야 함",
    );
  });

  it("rejects an entry with an empty label", () => {
    expectIssue(
      { vrm_url: "/v.vrm", available: [{ id: "a", label: "", url: "/a.vrm" }] },
      "available[0].label는 비어 있지 않은 문자열이어야 함",
    );
  });

  it("rejects an id with disallowed characters", () => {
    expectIssue(
      { vrm_url: "/v.vrm", available: [{ id: "a b", label: "A", url: "/a.vrm" }] },
      "available[0].id는 [A-Za-z0-9._-]만 허용",
    );
  });

  it("rejects an unknown source", () => {
    expectIssue(
      { vrm_url: "/v.vrm", available: [{ id: "a", label: "A", url: "/a.vrm", source: "cdn" }] },
      "available[0].source는",
    );
  });

  it("rejects duplicate ids", () => {
    expectIssue(
      {
        vrm_url: "/v.vrm",
        available: [
          { id: "a", label: "A", url: "/a.vrm" },
          { id: "a", label: "A2", url: "/a2.vrm" },
        ],
      },
      "available[1].id 중복",
    );
  });
});

describe("validateAvatar — framing", () => {
  it("rejects a non-object framing", () => {
    expectIssue({ vrm_url: "/v.vrm", framing: "nope" }, "framing은 객체여야 함");
  });

  it("rejects a negative margin", () => {
    expectIssue({ vrm_url: "/v.vrm", framing: { margin: -1 } }, "framing.margin은 0 이상");
  });

  it("rejects fov <= 0", () => {
    expectIssue({ vrm_url: "/v.vrm", framing: { fov: 0 } }, "framing.fov는 (0, 180)");
  });

  it("rejects fov >= 180", () => {
    expectIssue({ vrm_url: "/v.vrm", framing: { fov: 180 } }, "framing.fov는 (0, 180)");
  });
});

describe("validateAvatar — hit_test", () => {
  it("rejects a non-object hit_test", () => {
    expectIssue({ vrm_url: "/v.vrm", hit_test: "nope" }, "hit_test은 객체여야 함");
  });

  it("rejects a negative hysteresis_margin_px", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { hysteresis_margin_px: -1 } },
      "hit_test.hysteresis_margin_px는 0 이상",
    );
  });

  it("rejects poll_interval_ms <= 0 (exclusive minimum)", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { poll_interval_ms: 0 } },
      "hit_test.poll_interval_ms는 0보다 큰",
    );
  });

  it("rejects a non-integer debounce_samples", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { debounce_samples: 1.5 } },
      "hit_test.debounce_samples는 1 이상 정수여야 함",
    );
  });

  it("rejects debounce_samples below 1", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { debounce_samples: 0 } },
      "hit_test.debounce_samples는 1 이상 정수여야 함",
    );
  });

  it("rejects alpha_threshold outside (0, 1]", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { alpha_threshold: 0 } },
      "hit_test.alpha_threshold는 (0, 1]",
    );
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { alpha_threshold: 1.5 } },
      "hit_test.alpha_threshold는 (0, 1]",
    );
  });
});

describe("validateAvatar — gaze", () => {
  it("rejects a non-object gaze", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: "nope" }, "gaze는 객체여야 함");
  });

  it("accepts deadDeg:0 (inclusive lower bound)", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", gaze: { deadDeg: 0 } });
    expect(out.gaze?.deadDeg).toBe(0);
  });

  it("rejects headEngageDeg:0 (exclusive lower bound)", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { headEngageDeg: 0 } }, "gaze.headEngageDeg는");
  });

  it("rejects maxHeadYaw above 90", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { maxHeadYaw: 91 } }, "gaze.maxHeadYaw는");
  });

  it("rejects headNeckSplit outside [0, 1]", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { headNeckSplit: 1.1 } }, "gaze.headNeckSplit는");
  });

  it("accepts headNeckSplit:0 (inclusive lower bound)", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", gaze: { headNeckSplit: 0 } });
    expect(out.gaze?.headNeckSplit).toBe(0);
  });

  it("rejects smooth above 1000", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { smooth: 1001 } }, "gaze.smooth는");
  });

  it("rejects a non-finite gaze value", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { eyeMaxDeg: Number.NaN } }, "gaze.eyeMaxDeg는");
  });
});
