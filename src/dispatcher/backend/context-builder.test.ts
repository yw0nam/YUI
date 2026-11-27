import { describe, expect, it, vi } from "vitest";
import type { InputContext } from "../../contract";
import type { BusEnvelope } from "../core/event-bus";
import { renderClientContext } from "./client-context-text";
import { buildClientContext, buildContext } from "./context-builder";

const ENV: BusEnvelope = {
  seq_id: 1,
  source: "user_input_source",
  event_name: "user.text",
  ts: 1_717_000_000_000,
  payload: { text: "hello" },
};

describe("context builder", () => {
  it("builds env.timestamp/timezone and strips screenshot data from the wire shape", async () => {
    const built = await buildContext(ENV, {
      getScreenshot: async () => ({
        enabled: true,
        source: { kind: "monitor", index: 0 },
        data_url: "data:image/png;base64,SHOT",
      }),
    });

    expect(built.clientContext).toEqual({
      env: {
        timestamp: expect.any(String),
        timezone: expect.any(String),
      },
      screenshot: {
        enabled: true,
        source: { kind: "monitor", index: 0 },
      },
      trigger: { kind: "user" },
    });
    expect(built.ctx.screenshot?.data_url).toBe("data:image/png;base64,SHOT");
  });

  it("omits screenshot when the provider is absent", async () => {
    const built = await buildContext(ENV, {});
    expect(built.clientContext.screenshot).toBeUndefined();
  });

  it("omits screenshot when the provider resolves undefined", async () => {
    const built = await buildContext(ENV, { getScreenshot: async () => undefined });
    expect(built.clientContext.screenshot).toBeUndefined();
  });

  it("routes a screenshot provider error to onScreenshotError and still builds context", async () => {
    const onScreenshotError = vi.fn();
    const built = await buildContext(ENV, {
      getScreenshot: async () => {
        throw new Error("capture failed");
      },
      onScreenshotError,
    });

    expect(onScreenshotError).toHaveBeenCalledOnce();
    expect(built.clientContext.screenshot).toBeUndefined();
  });

  it("carries no active_app / active_window_title / posture / recent_apps fields", async () => {
    const built = await buildContext(ENV, {});
    expect(built.clientContext.env).not.toHaveProperty("active_app");
    expect(built.clientContext.env).not.toHaveProperty("active_window_title");
    expect(built.clientContext.env).not.toHaveProperty("posture");
    expect(built.clientContext.env).not.toHaveProperty("recent_apps");
  });

  it("carries env.frontmost from the provider", async () => {
    const built = await buildContext(ENV, {
      getFrontmost: () => ({
        app: "Cursor",
        window_title: "contract.md",
        since: 1_716_999_500_000,
      }),
    });

    expect(built.clientContext.env.frontmost).toEqual({
      app: "Cursor",
      window_title: "contract.md",
      since: 1_716_999_500_000,
    });
  });

  it("omits env.frontmost when the provider is absent or returns undefined", async () => {
    expect((await buildContext(ENV, {})).clientContext.env).not.toHaveProperty("frontmost");
    expect(
      (await buildContext(ENV, { getFrontmost: () => undefined })).clientContext.env,
    ).not.toHaveProperty("frontmost");
  });

  it("carries the held body state from the provider", async () => {
    const built = await buildContext(ENV, {
      getBodyState: () => ({
        posture: { state: "sitting", perched_on: { app: "Notes" } },
        since: 1_716_999_000_000,
      }),
    });

    expect(built.clientContext.body_state).toEqual({
      posture: { state: "sitting", perched_on: { app: "Notes" } },
      since: 1_716_999_000_000,
    });
  });

  it("omits body_state when the provider reports no posture", async () => {
    const built = await buildContext(ENV, { getBodyState: () => undefined });
    expect(built.clientContext).not.toHaveProperty("body_state");
  });

  it("omits body_state when the provider is absent", async () => {
    const built = await buildContext(ENV, {});
    expect(built.clientContext).not.toHaveProperty("body_state");
  });
});

describe("context builder — tool switches", () => {
  it("carries the switch list from the provider, read again every turn", async () => {
    let allowRequests = true;
    const read = () => [{ id: "look.screen", on: allowRequests }];

    const first = await buildContext(ENV, { getToolSwitches: read });
    expect(first.clientContext.tool_switches).toEqual([{ id: "look.screen", on: true }]);

    allowRequests = false;
    const second = await buildContext(ENV, { getToolSwitches: read });
    expect(second.clientContext.tool_switches).toEqual([{ id: "look.screen", on: false }]);
  });

  it("omits the field when the provider returns an empty list or is absent", async () => {
    const empty = await buildContext(ENV, { getToolSwitches: () => [] });
    expect("tool_switches" in empty.clientContext).toBe(false);

    const absent = await buildContext(ENV, {});
    expect("tool_switches" in absent.clientContext).toBe(false);
  });
});

describe("context builder — relations", () => {
  it("carries the relation entries from the provider, and omits the field when there are none", async () => {
    const relations = [
      { target: "user", band: "warm" as const, delta: 1, why: "stayed up", at: 7 },
      { target: "perlica", band: "cold" as const, delta: -2, why: "took the chair", at: 8 },
    ];

    const rated = await buildContext(ENV, { getRelations: () => relations });
    expect(rated.clientContext.relations).toEqual(relations);

    const none = await buildContext(ENV, { getRelations: () => [] });
    expect("relations" in none.clientContext).toBe(false);
  });
});

describe("context builder — threads waiting", () => {
  const WAITING = {
    total: 3,
    by_source: [
      { source: "claude-code", count: 2 },
      { source: "github-ci", count: 1 },
    ],
  };

  it("carries threads_waiting from the provider on a user turn", async () => {
    const built = await buildContext(ENV, { getThreadsWaiting: () => WAITING });
    expect(built.clientContext.threads_waiting).toEqual(WAITING);
  });

  it("omits threads_waiting on a proactive or signals turn", async () => {
    const proactive = await buildContext(
      { ...ENV, event_name: "proactive.idle" },
      { getThreadsWaiting: () => WAITING },
    );
    expect("threads_waiting" in proactive.clientContext).toBe(false);

    const signals = await buildContext(
      { ...ENV, event_name: "signals.batch" },
      { getThreadsWaiting: () => WAITING },
    );
    expect("threads_waiting" in signals.clientContext).toBe(false);
  });

  it("omits threads_waiting when nothing waits or the provider is absent", async () => {
    const zero = await buildContext(ENV, {
      getThreadsWaiting: () => ({ total: 0, by_source: [] }),
    });
    expect("threads_waiting" in zero.clientContext).toBe(false);

    const absent = await buildContext(ENV, {});
    expect("threads_waiting" in absent.clientContext).toBe(false);
  });
});

describe("context builder — threads attached", () => {
  it("carries the Threads a user turn's payload attached, and never on a turn the user did not start", async () => {
    const attached = [
      { id: "gmail:18c2", source: "gmail", title: "Quote reply" },
      { id: "codex:7", source: "codex", title: "Fix the flaky test" },
    ];
    const user = await buildContext(
      { ...ENV, payload: { text: "handle these", threads_attached: attached } },
      {},
    );
    expect(user.clientContext.threads_attached).toEqual(attached);

    const signals = await buildContext(
      { ...ENV, event_name: "signals.batch", payload: { threads_attached: attached } },
      {},
    );
    expect("threads_attached" in signals.clientContext).toBe(false);
  });
});

describe("context builder — open characters", () => {
  it("carries the names the provider returns, read again every turn", async () => {
    let open = ["alice"];
    const read = () => open;

    const first = await buildContext(ENV, { getOpenCharacters: read });
    expect(first.clientContext.open_characters).toEqual(["alice"]);

    open = ["alice", "bob"];
    const second = await buildContext(ENV, { getOpenCharacters: read });
    expect(second.clientContext.open_characters).toEqual(["alice", "bob"]);
  });

  it("omits the field when the provider returns none or is absent", async () => {
    const none = await buildContext(ENV, { getOpenCharacters: () => [] });
    expect("open_characters" in none.clientContext).toBe(false);

    const absent = await buildContext(ENV, {});
    expect("open_characters" in absent.clientContext).toBe(false);
  });
});

describe("context builder — do not disturb", () => {
  const local = (h: number, m: number) => new Date(2026, 10, 27, h, m).getTime();

  it.each([
    [
      "a Rest",
      { kind: "rest", choice: "morning", startedAt: local(21, 10), endsAt: local(8, 0) },
      { kind: "rest", since: local(21, 10), ends_local: "08:00" },
    ],
    ["a Rest with no recorded start", { kind: "rest", choice: "until_off" }, { kind: "rest" }],
    [
      "an off span",
      { kind: "quiet", endsAt: local(12, 0) },
      { kind: "off_span", ends_local: "12:00" },
    ],
  ] as const)("projects %s from the provider, read every turn", async (_name, rest, projected) => {
    const built = await buildContext(ENV, { getRest: () => rest });

    expect(built.clientContext.do_not_disturb).toEqual(projected);
  });
});

describe("buildClientContext — addressed forwarding", () => {
  const CTX: InputContext = { env: { timestamp: "2026-07-31T14:22:33+09:00", timezone: "UTC" } };

  function addressedEnv(payload: Record<string, unknown>): BusEnvelope {
    return {
      seq_id: 4,
      source: "addressed_source",
      event_name: "addressed.character",
      ts: 1_717_000_000_000,
      payload,
    };
  }

  it.each([
    {},
    { user_message: "  User\nquestion  " },
  ])("carries addressed metadata with %j", (extra) => {
    const client = buildClientContext(
      CTX,
      addressedEnv({
        from: "perlica",
        name: "Perlica",
        line: "natsume, you took my chair",
        ...extra,
      }),
    );

    expect(client.trigger.kind).toBe("addressed");
    expect(client.trigger.addressed).toEqual({
      from: "Perlica",
      text: "natsume, you took my chair",
      ts: 1_717_000_000_000,
      ...extra,
    });
  });

  it("keeps the addressed kind but omits the addressed field when the payload carries no line", () => {
    const client = buildClientContext(CTX, addressedEnv({ from: "perlica", name: "Perlica" }));

    expect(client.trigger.kind).toBe("addressed");
    expect("addressed" in client.trigger).toBe(false);
  });

  it("projects the stamped exchange when both numbers are present and the max is positive, and omits it at max 0", () => {
    const client = buildClientContext(
      CTX,
      addressedEnv({
        from: "perlica",
        name: "Perlica",
        line: "natsume, you took my chair",
        exchange: { used: 3, max: 10 },
      }),
    );

    expect(client.trigger.addressed).toEqual({
      from: "Perlica",
      text: "natsume, you took my chair",
      ts: 1_717_000_000_000,
      exchange: { used: 3, max: 10 },
    });

    const capped = buildClientContext(
      CTX,
      addressedEnv({ from: "perlica", name: "Perlica", line: "hi", exchange: { used: 1, max: 0 } }),
    );

    expect(capped.trigger.addressed).toEqual({
      from: "Perlica",
      text: "hi",
      ts: 1_717_000_000_000,
    });
  });
});

describe("buildClientContext — mention forwarding", () => {
  const CTX: InputContext = { env: { timestamp: "2026-07-31T14:22:33+09:00", timezone: "UTC" } };

  function userEnv(
    payload: Record<string, unknown>,
    event_name = "user.text_submitted",
  ): BusEnvelope {
    return { seq_id: 5, source: "user_input_source", event_name, ts: 1_717_000_000_000, payload };
  }

  it.each(["character", "everyone"] as const)("forwards a %s mention", (mention) => {
    expect(buildClientContext(CTX, userEnv({ text: "hi", mention })).trigger.mention).toBe(mention);
  });

  it.each([
    ["no mention", userEnv({ text: "hi" })],
    ["an unknown mention", userEnv({ text: "hi", mention: "all" })],
    ["a voice event", userEnv({ text: "hi", mention: "everyone" }, "user.voice_segment_ready")],
  ])("omits the field for %s", (_name, env) => {
    expect("mention" in buildClientContext(CTX, env).trigger).toBe(false);
  });
});

describe("buildClientContext — cue forwarding", () => {
  const CTX: InputContext = { env: { timestamp: "2026-07-31T14:22:33+09:00", timezone: "UTC" } };

  function cueEnv(payload: Record<string, unknown>): BusEnvelope {
    return {
      seq_id: 2,
      source: "os_event_watcher",
      event_name: "proactive.touch_chest",
      ts: 1_717_000_000_000,
      payload,
    };
  }

  it("forwards a label-only cue without a context key", () => {
    const client = buildClientContext(CTX, cueEnv({ cue_id: "touch_chest", label: "chest poked" }));

    expect(client.trigger.cue).toEqual({ label: "chest poked" });
    expect("context" in client.trigger.cue!).toBe(false);
  });

  it("forwards context when the firing source supplied one", () => {
    const client = buildClientContext(
      CTX,
      cueEnv({ cue_id: "morning", label: "morning call", context: "say good morning" }),
    );

    expect(client.trigger.cue).toEqual({ label: "morning call", context: "say good morning" });
  });

  it("omits the cue when the payload carries no label", () => {
    const client = buildClientContext(CTX, cueEnv({ cue_id: "touch_chest" }));

    expect("cue" in client.trigger).toBe(false);
  });

  it("reduces screenshot meta to enabled + source", () => {
    const client = buildClientContext(
      {
        ...CTX,
        screenshot: {
          enabled: true,
          source: { kind: "monitor", index: 0 },
          data_url: "data:image/png;base64,SHOT",
        },
      },
      cueEnv({}),
    );

    expect(client.screenshot).toEqual({ enabled: true, source: { kind: "monitor", index: 0 } });
  });
});

describe("buildClientContext — screen forwarding", () => {
  const CTX: InputContext = { env: { timestamp: "2026-07-31T14:22:33+09:00", timezone: "UTC" } };

  function screenEnv(eventName: string, payload: Record<string, unknown>): BusEnvelope {
    return {
      seq_id: 3,
      source: "os_event_watcher",
      event_name: eventName,
      ts: 1_717_000_000_000,
      payload,
    };
  }

  it("forwards an app_switched transition with the departed app and its dwell", () => {
    const client = buildClientContext(
      CTX,
      screenEnv("proactive.screen_app_switched", {
        transition: "app_switched",
        from_app: "Cursor",
        from_dwell_min: 34,
        dwell_min: 2,
      }),
    );

    expect(client.trigger.kind).toBe("proactive");
    expect(client.trigger.screen).toEqual({
      transition: "app_switched",
      from_app: "Cursor",
      from_dwell_min: 34,
      dwell_min: 2,
    });
  });

  it("forwards a long_session transition without the app_switched-only fields", () => {
    const client = buildClientContext(
      CTX,
      screenEnv("proactive.screen_long_session", { transition: "long_session", dwell_min: 45 }),
    );

    expect(client.trigger.screen).toEqual({ transition: "long_session", dwell_min: 45 });
    expect("from_app" in client.trigger.screen!).toBe(false);
    expect("from_dwell_min" in client.trigger.screen!).toBe(false);
  });

  it("omits screen on non-screen events carrying a screen-shaped payload", () => {
    const client = buildClientContext(
      CTX,
      screenEnv("proactive.tap_bored", { transition: "app_switched", dwell_min: 2 }),
    );

    expect("screen" in client.trigger).toBe(false);
  });

  it("omits screen when the payload is malformed", () => {
    expect(
      "screen" in
        buildClientContext(CTX, screenEnv("proactive.screen_long_session", { dwell_min: 45 }))
          .trigger,
    ).toBe(false);
    expect(
      "screen" in
        buildClientContext(
          CTX,
          screenEnv("proactive.screen_app_switched", { transition: "app_switched" }),
        ).trigger,
    ).toBe(false);
    expect(
      "screen" in
        buildClientContext(
          CTX,
          screenEnv("proactive.screen_app_switched", { transition: "resized", dwell_min: 2 }),
        ).trigger,
    ).toBe(false);
  });
});

describe("buildClientContext — waited members", () => {
  const CTX: InputContext = {
    env: { timestamp: "2026-11-27T12:00:00+09:00", timezone: "Asia/Seoul" },
  };
  const TOP_AT = 1_717_000_000_000;

  function bundleEnv(waited: BusEnvelope[]): BusEnvelope {
    return {
      seq_id: 9,
      source: "timer_scheduler",
      event_name: "schedule.lunch",
      ts: TOP_AT,
      payload: { cue_id: "lunch", label: "Lunch", time: "12:00", waited },
    };
  }

  it("projects each member through the single-trigger projections with its own at", () => {
    const milestone: BusEnvelope = {
      source: "timer_scheduler",
      event_name: "time_milestone.first_activity",
      ts: 2,
      payload: { name: "first_activity", local_time: "08:12" },
    };
    const screen: BusEnvelope = {
      source: "screen_watcher",
      event_name: "proactive.screen_app_switched",
      ts: 3,
      payload: {
        transition: "app_switched",
        app: "Slack",
        from_app: "Cursor",
        from_dwell_min: 34,
        dwell_min: 2,
      },
    };
    const addressed: BusEnvelope = {
      source: "addressed_source",
      event_name: "addressed.character",
      ts: 4,
      payload: { name: "alice", line: "hi" },
    };
    const gesture: BusEnvelope = {
      source: "os_event_watcher",
      event_name: "proactive.touch_face",
      ts: 5,
      payload: { cue_id: "touch_face", label: "face poked", gap_ms: 900_000 },
    };
    const noTs = {
      source: "timer_scheduler",
      event_name: "schedule.tea",
      ts: "6",
    } as unknown as BusEnvelope;

    const client = buildClientContext(
      CTX,
      bundleEnv([milestone, screen, addressed, gesture, noTs]),
    );

    expect(client.trigger.at).toBe(TOP_AT);
    expect(client.trigger.waited).toEqual([
      { kind: "milestone", at: 2, milestone: { name: "first_activity", local_time: "08:12" } },
      {
        kind: "proactive",
        at: 3,
        screen: {
          transition: "app_switched",
          app: "Slack",
          from_app: "Cursor",
          from_dwell_min: 34,
          dwell_min: 2,
        },
      },
      { kind: "addressed", at: 4, addressed: { from: "alice", text: "hi", ts: 4 } },
      { kind: "proactive", at: 5, cue: { label: "face poked" }, idle_elapsed_min: 15 },
    ]);
  });

  it("keeps an empty waited list, and omits both fields without one", () => {
    expect(buildClientContext(CTX, bundleEnv([])).trigger.waited).toEqual([]);

    const plain = buildClientContext(CTX, {
      seq_id: 10,
      source: "timer_scheduler",
      event_name: "schedule.lunch",
      ts: TOP_AT,
      payload: { cue_id: "lunch", label: "Lunch", time: "12:00" },
    });
    expect("waited" in plain.trigger).toBe(false);
    expect("at" in plain.trigger).toBe(false);
  });
});

describe("buildClientContext — signals on a user turn and a waited bundle", () => {
  const CTX: InputContext = {
    env: { timestamp: "2026-11-27T12:00:00+09:00", timezone: "Asia/Seoul" },
  };
  const GROUPS = [
    {
      envelope: {
        source: "n8n",
        event_type: "workflow_done",
        delivery: "batched",
        event_id: "run-1",
        occurred_at: 1,
      },
      items: [{ a: 1 }],
    },
  ];

  it("projects groups that ride on a user turn", () => {
    const client = buildClientContext(CTX, {
      seq_id: 11,
      source: "user_input_source",
      event_name: "user.text_submitted",
      ts: 1,
      payload: { text: "hi", signals: GROUPS },
    });

    expect(client.trigger.signals).toEqual(GROUPS);
  });

  it("projects groups on any envelope that carries waited members", () => {
    const client = buildClientContext(CTX, {
      seq_id: 12,
      source: "timer_scheduler",
      event_name: "schedule.lunch",
      ts: 1,
      payload: { cue_id: "lunch", label: "Lunch", waited: [], signals: GROUPS },
    });

    expect(client.trigger.signals).toEqual(GROUPS);
  });
});

describe("buildClientContext — milestone forwarding", () => {
  const CTX: InputContext = { env: { timestamp: "2026-09-11T08:12:00+09:00", timezone: "UTC" } };

  function milestoneEnv(payload: Record<string, unknown>): BusEnvelope {
    return {
      seq_id: 4,
      source: "timer_scheduler",
      event_name: "time_milestone.first_activity",
      ts: 1_717_000_000_000,
      payload,
    };
  }

  it("maps the event-name prefix to kind 'milestone' and forwards name + local_time", () => {
    const client = buildClientContext(
      CTX,
      milestoneEnv({ name: "first_activity", local_time: "08:12" }),
    );

    expect(client.trigger.kind).toBe("milestone");
    expect(client.trigger.milestone).toEqual({ name: "first_activity", local_time: "08:12" });
  });

  it("forwards the payload's last_together and drops a non-numeric one", () => {
    const numeric = buildClientContext(
      CTX,
      milestoneEnv({
        name: "first_activity",
        local_time: "08:12",
        last_together: 1_717_000_000_000,
      }),
    );
    expect(numeric.trigger.milestone).toEqual({
      name: "first_activity",
      local_time: "08:12",
      last_together: 1_717_000_000_000,
    });

    const nulled = buildClientContext(
      CTX,
      milestoneEnv({ name: "first_activity", local_time: "08:12", last_together: null }),
    );
    expect(nulled.trigger.milestone).toEqual({
      name: "first_activity",
      local_time: "08:12",
      last_together: null,
    });

    const invalid = buildClientContext(
      CTX,
      milestoneEnv({ name: "first_activity", local_time: "08:12", last_together: "08:00" }),
    );
    expect(invalid.trigger.milestone).toEqual({ name: "first_activity", local_time: "08:12" });
  });

  it("carries drained signal groups on a milestone turn", () => {
    const client = buildClientContext(
      CTX,
      milestoneEnv({
        name: "first_activity",
        local_time: "08:12",
        signals: [{ items: [{ skill: "yui-daily-briefing" }] }],
      }),
    );

    expect(client.trigger.signals).toEqual([{ items: [{ skill: "yui-daily-briefing" }] }]);
  });

  it("keeps the kind but omits the milestone field on a malformed payload", () => {
    const malformed: Array<Record<string, unknown>> = [
      { name: "first_activity" },
      { name: "first_activity", local_time: 812 },
      { local_time: "08:12" },
      { name: 1, local_time: "08:12" },
    ];

    for (const payload of malformed) {
      const client = buildClientContext(CTX, milestoneEnv(payload));
      expect(client.trigger.kind).toBe("milestone");
      expect("milestone" in client.trigger).toBe(false);
    }
  });
});

describe("context builder — previous turn", () => {
  it("carries a previous turn that ended interrupted", async () => {
    const previous = {
      event_name: "time_milestone.first_activity",
      ended: "interrupted",
      ts: 1_717_000_000_000,
    } as const;
    const built = await buildContext(ENV, { getPrevious: () => previous });
    expect(built.clientContext.previous).toEqual(previous);
  });

  it("carries a previous turn that ended failed", async () => {
    const previous = {
      event_name: "user.text_submitted",
      ended: "failed",
      ts: 1_717_000_000_000,
    } as const;
    const built = await buildContext(ENV, { getPrevious: () => previous });
    expect(built.clientContext.previous).toEqual(previous);
  });

  it("omits a previous turn that ended complete", async () => {
    const built = await buildContext(ENV, {
      getPrevious: () => ({
        event_name: "user.text_submitted",
        ended: "complete",
        ts: 1_717_000_000_000,
      }),
    });
    expect("previous" in built.clientContext).toBe(false);
  });

  it("omits the field when the slot is empty", async () => {
    const built = await buildContext(ENV, { getPrevious: () => undefined });
    expect("previous" in built.clientContext).toBe(false);
  });

  it("omits the field when no provider is wired", async () => {
    const built = await buildContext(ENV, {});
    expect("previous" in built.clientContext).toBe(false);
  });
});

describe("cue turn — complete client_context text at a fixed clock", () => {
  const NOW = 1_717_000_600_000;
  const CTX: InputContext = {
    env: { timestamp: "2026-07-31T09:30:00+09:00", timezone: "Asia/Seoul" },
    screenshot: { enabled: true, source: { kind: "monitor", index: 0 }, data_url: "data:x" },
  };
  const BODY = {
    posture: { state: "sitting", perched_on: { app: "Cursor" } },
    since: NOW - 720_000,
  } as const;
  const FRONTMOST = { app: "Google Chrome", window_title: "Inbox", since: NOW - 240_000 };

  function text(env: BusEnvelope): string {
    return renderClientContext(buildClientContext(CTX, env, BODY, FRONTMOST), NOW);
  }

  it("renders a schedule cue and a proactive cue", () => {
    const schedule = text({
      source: "timer_scheduler",
      event_name: "schedule.morning",
      ts: NOW,
      payload: {
        cue_id: "morning",
        label: "morning call",
        context: "say good morning",
      },
    });
    expect(schedule).toBe(
      [
        "time: 2026-07-31T09:30:00+09:00 (Asia/Seoul)",
        'frontmost: Google Chrome — "Inbox" (for 4min)',
        "screenshot source: monitor 0",
        "body: sitting on Cursor (for 12min)",
        'trigger: schedule cue "morning call"',
        "cue note (the user's own intent for this cue): say good morning",
      ].join("\n"),
    );

    const proactive = text({
      source: "timer_scheduler",
      event_name: "proactive.mid_check",
      ts: NOW,
      payload: {
        cue_id: "mid_check",
        label: "check in",
        context: "ask how it is going",
        gap_ms: 1_260_000,
      },
    });
    expect(proactive).toBe(
      [
        "time: 2026-07-31T09:30:00+09:00 (Asia/Seoul)",
        'frontmost: Google Chrome — "Inbox" (for 4min)',
        "screenshot source: monitor 0",
        "body: sitting on Cursor (for 12min)",
        'trigger: proactive cue "check in" (the user has been idle for 21min)',
        "cue note (the user's own intent for this cue): ask how it is going",
      ].join("\n"),
    );
  });
});
