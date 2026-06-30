/**
 * github-source.test.ts — GitHub PR watcher firing source.
 *
 * Locks the edge-detection state model (spec §Testing 1–7):
 *  1. fireable edges fire; SUCCESS/PENDING/EXPECTED/null never fire.
 *  2. re-failure regression guard: PENDING→FAILURE fires, →PENDING silent, →FAILURE fires AGAIN.
 *  3. cold start (no lastSeen → baseline, no fire) vs restart (persisted lastSeen → while-closed edge fires).
 *  4. present-gating: away buffers; return (present) emits ONE github.catchup; clears pending.
 *  5. cleanup: a PR absent from the current poll drops its pending (no stale catch-up) and its lastSeen entry.
 *  6. buffer cap 5 + flip-flop on one PR preserves transition order.
 *  7. githubQuery rejects / returns malformed → poll skipped, lastSeen untouched, no fire, no throw.
 *
 * All deps injected (fake bus / githubQuery / OS-channel listen / clock / scheduler) — no network, no timers.
 */

import { describe, expect, it, vi } from "vitest";
import type { PersistedStorage } from "../io/persisted-store";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import type { BusEnvelope, EventBus } from "./event-bus";
import { createGithubSource, type LastSeenMap } from "./github-source";

const PRESENT_MAX = 10_000;
const LOW_IDLE = 500; // present
const HIGH_IDLE = PRESENT_MAX + 1; // away

function fakeBus(): { bus: Pick<EventBus, "push">; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  const bus: Pick<EventBus, "push"> = {
    push: vi.fn((e: BusEnvelope) => {
      pushed.push(e);
      return true;
    }),
  };
  return { bus, pushed };
}

function fakeListen(): { listen: OsEventListen; emit: (p: OsEventPayload) => void } {
  let handler: ((e: { payload: OsEventPayload }) => void) | undefined;
  const listen: OsEventListen = vi.fn(async (_event, h) => {
    handler = h;
    return vi.fn();
  });
  return { listen, emit: (payload) => handler?.({ payload }) };
}

function idleTick(os_idle_ms: number | null, ts = 0): OsEventPayload {
  return { event_name: "os_idle_tick", ts, data: { os_idle_ms } };
}

function memStore(initial?: LastSeenMap): PersistedStorage<LastSeenMap> & {
  saved: LastSeenMap[];
} {
  let data: LastSeenMap | null = initial ? { ...initial } : null;
  const saved: LastSeenMap[] = [];
  return {
    saved,
    load: vi.fn(() => data),
    save: vi.fn((s: LastSeenMap) => {
      data = s;
      saved.push(s);
    }),
  };
}

interface PrSpec {
  repo: string;
  number: number;
  title?: string;
  url?: string;
  ci?: string | null;
  review?: string | null;
}

/** Mirror of the `gh api graphql` response envelope (keeps the top-level `data` wrapper). */
function ghResponse(prs: PrSpec[]): unknown {
  return {
    data: {
      viewer: {
        pullRequests: {
          nodes: prs.map((p) => ({
            repository: { nameWithOwner: p.repo },
            number: p.number,
            title: p.title ?? `PR ${p.number}`,
            url: p.url ?? `https://github.com/${p.repo}/pull/${p.number}`,
            commits: {
              nodes: [{ commit: { statusCheckRollup: p.ci == null ? null : { state: p.ci } } }],
            },
            reviewDecision: p.review ?? null,
          })),
        },
      },
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Harness {
  pushed: BusEnvelope[];
  store: ReturnType<typeof memStore>;
  query: ReturnType<typeof vi.fn>;
  setIdle: (v: number | null) => void;
  clock: { t: number };
  /** drive exactly one poll, advancing the clock to `t` if given. */
  pump: (t?: number) => Promise<void>;
  stop: () => void;
}

async function harness(opts?: {
  preload?: LastSeenMap;
  isEnabled?: () => boolean;
}): Promise<Harness> {
  const { bus, pushed } = fakeBus();
  const { listen, emit } = fakeListen();
  const store = memStore(opts?.preload);
  const query = vi.fn();
  const clock = { t: 1000 };
  let scheduled: (() => void) | null = null;

  const src = createGithubSource({
    bus,
    githubQuery: query,
    present_max_idle_ms: PRESENT_MAX,
    isEnabled: opts?.isEnabled ?? (() => true),
    getPollIntervalMs: () => 60_000,
    lastSeenStore: store,
    listen,
    now: () => clock.t,
    setTimeoutFn: (cb) => {
      scheduled = cb;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  });

  await src.start();

  return {
    pushed,
    store,
    query,
    setIdle: (v) => emit(idleTick(v)),
    clock,
    async pump(t) {
      if (t !== undefined) clock.t = t;
      const cb = scheduled;
      scheduled = null;
      cb?.();
      await flush();
    },
    stop: () => src.stop(),
  };
}

describe("github_source — fireable edges (spec §1)", () => {
  it("fires github.ci_failed on a PENDING→FAILURE edge", async () => {
    const h = await harness();
    h.setIdle(LOW_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "PENDING" }]));
    await h.pump(); // baseline
    expect(h.pushed).toHaveLength(0);

    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
    await h.pump();
    expect(h.pushed).toHaveLength(1);
    const e = h.pushed[0];
    expect(e.source).toBe("timer_scheduler");
    expect(e.event_name).toBe("github.ci_failed");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    expect(e.payload).toMatchObject({
      repo: "o/r",
      number: 1,
      url: "https://github.com/o/r/pull/1",
      event: "ci_failed",
      from: "PENDING",
      to: "FAILURE",
    });
  });

  it("fires github.ci_failed on an ERROR edge (infra failure == CI broke)", async () => {
    const h = await harness();
    h.setIdle(LOW_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "PENDING" }]));
    await h.pump();
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "ERROR" }]));
    await h.pump();
    expect(h.pushed.map((e) => e.event_name)).toEqual(["github.ci_failed"]);
    expect(h.pushed[0].payload).toMatchObject({ event: "ci_failed", from: "PENDING", to: "ERROR" });
  });

  it("fires github.review_changes and github.review_approved on review edges", async () => {
    const h = await harness();
    h.setIdle(LOW_IDLE);
    h.query.mockResolvedValueOnce(
      ghResponse([{ repo: "o/r", number: 1, review: "REVIEW_REQUIRED" }]),
    );
    await h.pump();
    h.query.mockResolvedValueOnce(
      ghResponse([{ repo: "o/r", number: 1, review: "CHANGES_REQUESTED" }]),
    );
    await h.pump();
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, review: "APPROVED" }]));
    await h.pump();
    expect(h.pushed.map((e) => e.event_name)).toEqual([
      "github.review_changes",
      "github.review_approved",
    ]);
    expect(h.pushed[0].payload).toMatchObject({ event: "review_changes", to: "CHANGES_REQUESTED" });
    expect(h.pushed[1].payload).toMatchObject({ event: "review_approved", to: "APPROVED" });
  });

  it("never fires on SUCCESS / PENDING / EXPECTED / null edges", async () => {
    const h = await harness();
    h.setIdle(LOW_IDLE);
    for (const ci of ["PENDING", "SUCCESS", "EXPECTED", "PENDING", null]) {
      h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci }]));
      await h.pump();
    }
    expect(h.pushed).toHaveLength(0);
  });
});

describe("github_source — re-failure regression guard (spec §2)", () => {
  it("PENDING→FAILURE fires, →PENDING silent, →FAILURE fires AGAIN", async () => {
    const h = await harness();
    h.setIdle(LOW_IDLE);
    const seq = ["PENDING", "FAILURE", "PENDING", "FAILURE"];
    for (const ci of seq) {
      h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci }]));
      await h.pump();
    }
    expect(h.pushed.map((e) => e.event_name)).toEqual(["github.ci_failed", "github.ci_failed"]);
  });
});

describe("github_source — cold start vs restart (spec §3)", () => {
  it("cold start: a PR with no lastSeen records a baseline and does NOT fire", async () => {
    const h = await harness(); // no preload
    h.setIdle(LOW_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
    await h.pump();
    expect(h.pushed).toHaveLength(0);
    expect(h.store.save).toHaveBeenCalled();
    expect(h.store.saved.at(-1)).toEqual({ "o/r#1": { ci: "FAILURE", review: null } });
  });

  it("restart: a persisted lastSeen fires a while-closed edge on the first poll", async () => {
    const h = await harness({ preload: { "o/r#1": { ci: "PENDING", review: null } } });
    h.setIdle(LOW_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
    await h.pump();
    expect(h.pushed.map((e) => e.event_name)).toEqual(["github.ci_failed"]);
    expect(h.pushed[0].payload).toMatchObject({ from: "PENDING", to: "FAILURE" });
  });
});

describe("github_source — present-gating + catch-up (spec §4)", () => {
  it("away buffers; return (present) emits ONE github.catchup and clears pending", async () => {
    const h = await harness();

    // away — baseline then a buffered FAILURE edge (no live fire).
    h.setIdle(HIGH_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "PENDING" }]));
    await h.pump(2000);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
    await h.pump(3000);
    expect(h.pushed).toHaveLength(0);

    // return (present), PR unchanged — exactly one catch-up carrying the buffered transition.
    h.setIdle(LOW_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
    await h.pump(4000);
    expect(h.pushed.map((e) => e.event_name)).toEqual(["github.catchup"]);
    const cu = h.pushed[0].payload as {
      prs: Array<{ repo: string; transitions: Array<Record<string, unknown>> }>;
    };
    expect(cu.prs).toHaveLength(1);
    expect(cu.prs[0].repo).toBe("o/r");
    expect(cu.prs[0].transitions).toEqual([
      { kind: "ci", from: "PENDING", to: "FAILURE", ts: 3000 },
    ]);

    // pending cleared — a subsequent unchanged present poll emits nothing further.
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
    await h.pump(5000);
    expect(h.pushed).toHaveLength(1);
  });
});

describe("github_source — cleanup of merged/closed PRs (spec §5)", () => {
  it("a PR absent from the poll drops its pending (no stale catch-up) and its lastSeen entry", async () => {
    const h = await harness();

    // away: baseline then buffer a FAILURE for PR #1.
    h.setIdle(HIGH_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "PENDING" }]));
    await h.pump();
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
    await h.pump();

    // PR #1 merged → absent from this (present) poll: no stale catch-up, entry dropped.
    h.setIdle(LOW_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([]));
    await h.pump();
    expect(h.pushed).toHaveLength(0);
    expect(h.store.saved.at(-1)).toEqual({});
  });
});

describe("github_source — buffer cap 5 + order (spec §6)", () => {
  it("keeps only the last 5 buffered transitions, in order", async () => {
    const h = await harness();
    h.setIdle(HIGH_IDLE);

    // baseline PENDING.
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "PENDING" }]));
    await h.pump(0);

    // flip-flop: 7 FAILURE edges at t=10,20,...,70 (each preceded by a PENDING reset).
    const failTimes: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const ft = i * 10;
      h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
      await h.pump(ft);
      failTimes.push(ft);
      h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "PENDING" }]));
      await h.pump(ft + 1);
    }
    expect(h.pushed).toHaveLength(0); // all away → all buffered

    // present, unchanged (still PENDING) — flush the buffer.
    h.setIdle(LOW_IDLE);
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "PENDING" }]));
    await h.pump(100);
    expect(h.pushed.map((e) => e.event_name)).toEqual(["github.catchup"]);
    const cu = h.pushed[0].payload as { prs: Array<{ transitions: Array<{ ts: number }> }> };
    const ts = cu.prs[0].transitions.map((t) => t.ts);
    expect(ts).toEqual(failTimes.slice(-5)); // last 5, oldest dropped, order preserved
  });
});

describe("github_source — gh failure / malformed (spec §7)", () => {
  it("rejection and malformed JSON skip the poll: no fire, lastSeen untouched, no throw", async () => {
    const h = await harness({ preload: { "o/r#1": { ci: "PENDING", review: null } } });
    h.setIdle(LOW_IDLE);

    // gh rejects → skip.
    h.query.mockRejectedValueOnce(new Error("gh: not authenticated"));
    await expect(h.pump()).resolves.toBeUndefined();
    // malformed JSON → skip.
    h.query.mockResolvedValueOnce({ data: { viewer: null } });
    await h.pump();
    expect(h.pushed).toHaveLength(0);
    expect(h.store.save).not.toHaveBeenCalled();

    // lastSeen survived: the next valid poll still sees PENDING and fires on FAILURE.
    h.query.mockResolvedValueOnce(ghResponse([{ repo: "o/r", number: 1, ci: "FAILURE" }]));
    await h.pump();
    expect(h.pushed.map((e) => e.event_name)).toEqual(["github.ci_failed"]);
    expect(h.pushed[0].payload).toMatchObject({ from: "PENDING", to: "FAILURE" });
  });
});

describe("github_source — lifecycle", () => {
  it("start() is idempotent and stop() is safe off-Tauri", async () => {
    const { bus } = fakeBus();
    const store = memStore();
    const src = createGithubSource({
      bus,
      githubQuery: vi.fn().mockRejectedValue(new Error("no tauri")),
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      getPollIntervalMs: () => 60_000,
      lastSeenStore: store,
      listen: undefined,
      setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    });
    await expect(src.start()).resolves.toBeUndefined();
    await expect(src.start()).resolves.toBeUndefined();
    expect(() => src.stop()).not.toThrow();
  });
});
