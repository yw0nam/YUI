import { describe, expect, it } from "vitest";
import { validateMotions } from "./motions";
import { ConfigError } from "./shared";

const FILE = "motions.json";

/** Minimal valid single-entry registry. */
function baseEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    vrma_path: "/motions/idle.vrma",
    kind: "ambient",
    loop: true,
    priority: 0,
    interrupt_policy: "replace",
    ...overrides,
  };
}

function expectIssue(raw: unknown, fragment: string): void {
  try {
    validateMotions(FILE, raw);
    expect.unreachable("validateMotions should have thrown");
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

describe("validateMotions — happy path", () => {
  it("accepts a minimal valid entry", () => {
    const out = validateMotions(FILE, { idle: baseEntry() });
    expect(out.idle).toEqual(baseEntry());
  });

  it("accepts a full entry with all optional fields (cycle motion)", () => {
    const entry = baseEntry({
      loop: true,
      variants: ["/motions/a.vrma", "/motions/b.vrma"],
      variant_policy: "random",
      cycle_dwell_ms: 500,
      fade_ms: 200,
      broker_publish: false,
    });
    const out = validateMotions(FILE, { window_sit: entry });
    expect(out.window_sit).toEqual(entry);
  });

  it("accepts a pingpong entry with loop_cycles", () => {
    const entry = baseEntry({
      loop: true,
      pingpong: true,
      loop_cycles: [1, 3],
    });
    const out = validateMotions(FILE, { sway: entry });
    expect(out.sway).toEqual(entry);
  });

  it("passes through multiple ids independently", () => {
    const out = validateMotions(FILE, {
      idle: baseEntry(),
      drag: baseEntry({ kind: "reactive", priority: 80 }),
    });
    expect(Object.keys(out)).toEqual(["idle", "drag"]);
  });
});

describe("validateMotions — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "객체가 아님");
    expectIssue("x", "객체가 아님");
    expectIssue(null, "객체가 아님");
  });

  it("rejects an empty registry", () => {
    expectIssue({}, "최소 1개 모션이 등록되어야 함");
  });

  it("rejects a non-object entry", () => {
    expectIssue({ idle: "not-an-object" }, "항목이 객체가 아님");
  });
});

describe("validateMotions — field validation", () => {
  it("rejects vrma_path missing the .vrma extension", () => {
    expectIssue({ idle: baseEntry({ vrma_path: "/motions/idle.fbx" }) }, "vrma_path");
  });

  it("rejects vrma_path that isn't a string", () => {
    expectIssue({ idle: baseEntry({ vrma_path: 42 }) }, "vrma_path");
  });

  it("rejects an unknown kind", () => {
    expectIssue({ idle: baseEntry({ kind: "bogus" }) }, "kind는");
  });

  it("rejects a non-boolean loop", () => {
    expectIssue({ idle: baseEntry({ loop: "yes" }) }, "loop은 boolean이어야 함");
  });

  it("rejects priority below 0", () => {
    expectIssue({ idle: baseEntry({ priority: -1 }) }, "priority는 0~100");
  });

  it("rejects priority above 100", () => {
    expectIssue({ idle: baseEntry({ priority: 101 }) }, "priority는 0~100");
  });

  it("rejects NaN priority", () => {
    expectIssue({ idle: baseEntry({ priority: Number.NaN }) }, "priority는 0~100");
  });

  it("rejects Infinity priority", () => {
    expectIssue({ idle: baseEntry({ priority: Number.POSITIVE_INFINITY }) }, "priority는 0~100");
  });

  it("rejects an unknown interrupt_policy", () => {
    expectIssue({ idle: baseEntry({ interrupt_policy: "bogus" }) }, "interrupt_policy는");
  });
});

describe("validateMotions — variants / variant_policy", () => {
  it("rejects variants that isn't an array", () => {
    expectIssue({ idle: baseEntry({ variants: "not-array" }) }, "variants는 문자열 배열이어야 함");
  });

  it("rejects a variants array with non-string entries", () => {
    expectIssue(
      { idle: baseEntry({ variants: ["/a.vrma", 1] }) },
      "variants는 문자열 배열이어야 함",
    );
  });

  it("rejects a single-item variants array (needs >=2)", () => {
    expectIssue({ idle: baseEntry({ variants: ["/a.vrma"] }) }, "variants는 2개 이상이어야 함");
  });

  it("rejects a variants entry not ending in .vrma", () => {
    expectIssue(
      { idle: baseEntry({ variants: ["/a.vrma", "/b.fbx"] }) },
      "variants의 각 항목은 .vrma로 끝나야 함",
    );
  });

  it("rejects an unknown variant_policy", () => {
    expectIssue(
      { idle: baseEntry({ variants: ["/a.vrma", "/b.vrma"], variant_policy: "bogus" }) },
      "variant_policy는",
    );
  });

  it("rejects variant_policy set without variants (dead field)", () => {
    expectIssue(
      { idle: baseEntry({ variant_policy: "random" }) },
      "variant_policy는 variants 없이 의미 없음",
    );
  });
});

describe("validateMotions — broker_publish", () => {
  it("rejects a non-boolean broker_publish", () => {
    expectIssue({ idle: baseEntry({ broker_publish: "true" }) }, "broker_publish는 boolean");
  });
});

describe("validateMotions — cycle_dwell_ms", () => {
  it("rejects a non-integer", () => {
    expectIssue(
      {
        idle: baseEntry({
          loop: true,
          variants: ["/a.vrma", "/b.vrma"],
          cycle_dwell_ms: 100.5,
        }),
      },
      "cycle_dwell_ms는 0~60000 사이 정수여야 함",
    );
  });

  it("rejects a negative value", () => {
    expectIssue(
      {
        idle: baseEntry({
          loop: true,
          variants: ["/a.vrma", "/b.vrma"],
          cycle_dwell_ms: -1,
        }),
      },
      "cycle_dwell_ms는 0~60000 사이 정수여야 함",
    );
  });

  it("rejects a value above 60000", () => {
    expectIssue(
      {
        idle: baseEntry({
          loop: true,
          variants: ["/a.vrma", "/b.vrma"],
          cycle_dwell_ms: 60001,
        }),
      },
      "cycle_dwell_ms는 0~60000 사이 정수여야 함",
    );
  });

  it("rejects cycle_dwell_ms on a non-cycle motion (dead field)", () => {
    expectIssue(
      { idle: baseEntry({ loop: false, cycle_dwell_ms: 500 }) },
      "cycle_dwell_ms는 cycle 모션(variants>1 + loop)에만 유효함",
    );
  });
});

describe("validateMotions — pingpong / loop_cycles", () => {
  it("rejects a non-boolean pingpong", () => {
    expectIssue(
      { idle: baseEntry({ loop: true, pingpong: "true" }) },
      "pingpong은 boolean이어야 함",
    );
  });

  it("rejects pingpong:true without loop:true", () => {
    expectIssue(
      { idle: baseEntry({ loop: false, pingpong: true }) },
      "pingpong:true는 loop:true를 요구함",
    );
  });

  it("rejects pingpong:true combined with crossfade_loop:true", () => {
    expectIssue(
      { idle: baseEntry({ loop: true, pingpong: true, crossfade_loop: true }) },
      "pingpong과 crossfade_loop는 상호 배타임",
    );
  });

  it("rejects loop_cycles without pingpong:true (dead field)", () => {
    expectIssue(
      { idle: baseEntry({ loop: true, loop_cycles: [1, 2] }) },
      "loop_cycles는 pingpong:true 없이 의미 없음",
    );
  });

  it("rejects loop_cycles that isn't a 2-element array", () => {
    expectIssue(
      { idle: baseEntry({ loop: true, pingpong: true, loop_cycles: [1] }) },
      "loop_cycles는 lo<=hi인 양의 정수 2개 배열이어야 함",
    );
  });

  it("rejects loop_cycles with lo > hi", () => {
    expectIssue(
      { idle: baseEntry({ loop: true, pingpong: true, loop_cycles: [3, 1] }) },
      "loop_cycles는 lo<=hi인 양의 정수 2개 배열이어야 함",
    );
  });

  it("rejects loop_cycles with a zero/non-positive entry", () => {
    expectIssue(
      { idle: baseEntry({ loop: true, pingpong: true, loop_cycles: [0, 2] }) },
      "loop_cycles는 lo<=hi인 양의 정수 2개 배열이어야 함",
    );
  });

  it("rejects loop_cycles with a non-integer entry", () => {
    expectIssue(
      { idle: baseEntry({ loop: true, pingpong: true, loop_cycles: [1, 2.5] }) },
      "loop_cycles는 lo<=hi인 양의 정수 2개 배열이어야 함",
    );
  });
});

describe("validateMotions — fade_ms", () => {
  it("rejects a non-integer", () => {
    expectIssue({ idle: baseEntry({ fade_ms: 100.5 }) }, "fade_ms는 0~5000 사이 정수여야 함");
  });

  it("rejects a negative value", () => {
    expectIssue({ idle: baseEntry({ fade_ms: -1 }) }, "fade_ms는 0~5000 사이 정수여야 함");
  });

  it("rejects a value above 5000", () => {
    expectIssue({ idle: baseEntry({ fade_ms: 5001 }) }, "fade_ms는 0~5000 사이 정수여야 함");
  });

  it("accepts fade_ms on any entry, not just cycle motions", () => {
    const out = validateMotions(FILE, { idle: baseEntry({ fade_ms: 300 }) });
    expect(out.idle.fade_ms).toBe(300);
  });
});

describe("validateMotions — multiple issues accumulate", () => {
  it("reports issues for every offending entry, not just the first", () => {
    try {
      validateMotions(FILE, {
        idle: baseEntry({ kind: "bogus" }),
        drag: baseEntry({ loop: "yes" }),
      });
      expect.unreachable("validateMotions should have thrown");
    } catch (e) {
      const err = e as ConfigError;
      expect(err.issues.length).toBe(2);
      expect(err.issues.some((i) => i.startsWith("idle."))).toBe(true);
      expect(err.issues.some((i) => i.startsWith("drag."))).toBe(true);
    }
  });
});
