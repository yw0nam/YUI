/**
 * github_source — GitHub PR watcher firing source.
 *
 * Polls the viewer's open PRs (sliding interval) and detects per-field edges
 * (CI rollup, review decision) against `lastSeen` (the previous poll, persisted).
 * A fireable edge fires a `github.<event>` candidate when the user is present, or
 * buffers per-PR while away and flushes one `github.catchup` on return. Merged /
 * closed PRs are cleaned out of both maps each poll.
 *
 * State model is edge-based (current poll vs lastSeen), so a re-failure is a fresh
 * edge that fires again — there is no level-comparison anti-re-announce guard.
 *
 * firing ≠ judgment: this only produces candidate events from raw transitions; the
 * backend decides whether/what to speak (empty speech = silence). No phrasing or
 * speak/don't-speak gate lives here.
 */

import type { PersistedStorage } from "../io/persisted-store";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { OS_EVENT_CHANNEL, resolveTauriListen } from "../io/tauri-listen";
import { createLogger } from "../logger";
import type { EventBus } from "./event-bus";

const log = createLogger("github-source");

/** Maximum number of open PRs fetched per poll. */
const PR_QUERY_LIMIT = 30;

/** One open PR authored by the viewer, with CI rollup + review decision. */
export const PR_QUERY = `{ viewer { pullRequests(states: OPEN, first: ${PR_QUERY_LIMIT},
    orderBy: { field: UPDATED_AT, direction: DESC }) { nodes {
      repository { nameWithOwner }
      number title url
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      reviewDecision } } } }`;

/** Last-observed CI/review per PR; `null` means the field has no value (e.g. no checks). */
export interface LastSeen {
  ci: string | null;
  review: string | null;
}

/** prKey ("owner/repo#number") → last observed fields. Persisted as a flat JSON blob. */
export type LastSeenMap = Record<string, LastSeen>;

export type TransitionKind = "ci" | "review";

interface Transition {
  kind: TransitionKind;
  from: string | null;
  to: string;
  ts: number;
}

interface ParsedPr {
  prKey: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  ci: string | null;
  review: string | null;
}

export interface GithubSourceDeps {
  bus: Pick<EventBus, "push">;
  /** Transport seam: run a GraphQL query, resolve parsed JSON, reject on gh failure. */
  githubQuery: (graphql: string) => Promise<unknown>;
  /** Present iff cached OS idle ≤ this. Inverted vs proactive/schedule (those fire on HIGH idle). */
  present_max_idle_ms: number;
  /** Read inside each poll — gates firing without stopping the loop. */
  isEnabled: () => boolean;
  /** Read after each poll completes — drives the sliding interval. */
  getPollIntervalMs: () => number;
  /** Persisted `lastSeen` blob (localStorage in app, in-memory in tests). */
  lastSeenStore: PersistedStorage<LastSeenMap>;
  /** Injectable channel listen; defaults to the resolved Tauri `listen`. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Injectable scheduler; defaults to global setTimeout. Lets tests drive the loop. */
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export interface GithubSource {
  start(): Promise<void>;
  stop(): void;
}

const BUFFER_CAP = 5;

function isFireable(kind: TransitionKind, value: string | null): value is string {
  if (value == null) return false;
  if (kind === "ci") return value === "FAILURE" || value === "ERROR";
  return value === "CHANGES_REQUESTED" || value === "APPROVED";
}

function eventName(
  kind: TransitionKind,
  to: string,
): "ci_failed" | "review_changes" | "review_approved" {
  if (kind === "ci") return "ci_failed";
  return to === "APPROVED" ? "review_approved" : "review_changes";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Parse the `gh api graphql` envelope into open PRs; return null on malformed/partial JSON. */
function parsePrs(raw: unknown): ParsedPr[] | null {
  const data = asRecord(asRecord(raw)?.data);
  const viewer = asRecord(data?.viewer);
  const pullRequests = asRecord(viewer?.pullRequests);
  const nodes = pullRequests?.nodes;
  if (!Array.isArray(nodes)) return null;

  const out: ParsedPr[] = [];
  for (const rawNode of nodes) {
    const node = asRecord(rawNode);
    const repo = asRecord(node?.repository)?.nameWithOwner;
    const number = node?.number;
    const title = node?.title;
    const url = node?.url;
    if (
      typeof repo !== "string" ||
      typeof number !== "number" ||
      typeof title !== "string" ||
      typeof url !== "string"
    ) {
      return null;
    }
    const commitNodes = asRecord(node?.commits)?.nodes;
    const firstCommit = Array.isArray(commitNodes) ? asRecord(commitNodes[0]) : null;
    const rollup = asRecord(asRecord(firstCommit?.commit)?.statusCheckRollup);
    const ci = typeof rollup?.state === "string" ? rollup.state : null;
    const review = typeof node?.reviewDecision === "string" ? node.reviewDecision : null;
    out.push({ prKey: `${repo}#${number}`, repo, number, title, url, ci, review });
  }
  return out;
}

export function createGithubSource(deps: GithubSourceDeps): GithubSource {
  const { bus, githubQuery, present_max_idle_ms, isEnabled, getPollIntervalMs, lastSeenStore } =
    deps;
  const now = deps.now ?? Date.now;
  const setTimeoutFn = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));

  const lastSeen = new Map<string, LastSeen>();
  const loaded = lastSeenStore.load();
  if (loaded) {
    for (const [key, val] of Object.entries(loaded)) {
      const entry = asRecord(val);
      if (!entry) continue;
      const ci = typeof entry.ci === "string" ? entry.ci : null;
      const review = typeof entry.review === "string" ? entry.review : null;
      lastSeen.set(key, { ci, review });
    }
  }

  const pending = new Map<string, Transition[]>();
  let lastIdleMs: number | null = null;
  let unlisten: (() => void) | undefined;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    lastIdleMs = payload.data.os_idle_ms ?? null;
  }

  function pushLive(pr: ParsedPr, t: Transition): void {
    const event = eventName(t.kind, t.to);
    bus.push({
      source: "timer_scheduler",
      event_name: `github.${event}`,
      ts: t.ts,
      hint_tier: 2,
      dnd_override: false,
      payload: {
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        event,
        from: t.from,
        to: t.to,
      },
    });
  }

  function buffer(prKey: string, t: Transition): void {
    const arr = pending.get(prKey) ?? [];
    arr.push(t);
    // Caps the buffer at BUFFER_CAP; the oldest entry is dropped when the limit is exceeded.
    if (arr.length > BUFFER_CAP) arr.shift();
    pending.set(prKey, arr);
  }

  function detect(
    pr: ParsedPr,
    kind: TransitionKind,
    prev: string | null,
    present: boolean,
    ts: number,
  ): void {
    const cur = kind === "ci" ? pr.ci : pr.review;
    if (cur === prev) return;
    if (!isFireable(kind, cur)) return;
    const t: Transition = { kind, from: prev, to: cur, ts };
    if (present) pushLive(pr, t);
    else buffer(pr.prKey, t);
  }

  function flushCatchup(byKey: Map<string, ParsedPr>, ts: number): void {
    if (pending.size === 0) return;
    const prs: Array<{
      repo: string;
      number: number;
      title: string;
      url: string;
      transitions: Transition[];
    }> = [];
    for (const [prKey, transitions] of pending) {
      const pr = byKey.get(prKey); // still-open PRs only
      if (!pr || transitions.length === 0) continue;
      prs.push({ repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, transitions });
    }
    if (prs.length > 0) {
      bus.push({
        source: "timer_scheduler",
        event_name: "github.catchup",
        ts,
        hint_tier: 2,
        dnd_override: false,
        payload: { prs },
      });
    }
    pending.clear();
  }

  function cleanup(openKeys: Set<string>): void {
    for (const key of [...lastSeen.keys()]) {
      if (!openKeys.has(key)) lastSeen.delete(key);
    }
    for (const key of [...pending.keys()]) {
      if (!openKeys.has(key)) pending.delete(key);
    }
  }

  function persist(): void {
    const blob: LastSeenMap = {};
    for (const [key, val] of lastSeen) blob[key] = val;
    lastSeenStore.save(blob);
  }

  async function poll(): Promise<void> {
    if (!isEnabled()) return;

    let raw: unknown;
    try {
      raw = await githubQuery(PR_QUERY);
    } catch (err) {
      log.warn("poll_failed", { error: String(err) });
      return;
    }
    const prs = parsePrs(raw);
    if (prs === null) {
      log.warn("poll_malformed");
      return;
    }

    const ts = now();
    // The present gate is inverted compared to proactive/schedule sources: github fires on
    // low idle (user at keyboard) rather than high. Null or unknown idle is treated as away.
    const present = lastIdleMs != null && lastIdleMs <= present_max_idle_ms;
    log.debug("poll_ok", { prs: prs.length, present });
    const byKey = new Map(prs.map((p) => [p.prKey, p]));
    const openKeys = new Set(byKey.keys());

    for (const pr of prs) {
      const prev = lastSeen.get(pr.prKey);
      if (prev !== undefined) {
        detect(pr, "ci", prev.ci, present, ts);
        detect(pr, "review", prev.review, present, ts);
      }
      lastSeen.set(pr.prKey, { ci: pr.ci, review: pr.review });
    }

    if (present) flushCatchup(byKey, ts);
    cleanup(openKeys);
    persist();
  }

  async function tick(): Promise<void> {
    if (!running) return;
    await poll();
    if (running) timer = setTimeoutFn(tick, getPollIntervalMs());
  }

  async function start(): Promise<void> {
    if (running) return;
    running = true;

    let listen: OsEventListen | undefined;
    try {
      listen = deps.listen ?? (await resolveTauriListen());
    } catch (err) {
      log.debug("listen_resolve_failed", { degrade: true, error: String(err) });
    }
    if (listen) {
      try {
        unlisten = await listen(OS_EVENT_CHANNEL, ({ payload }) => onTick(payload));
      } catch (err) {
        log.debug("subscribe_failed", { degrade: true, error: String(err) });
      }
    }

    timer = setTimeoutFn(tick, 0);
  }

  function stop(): void {
    running = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    unlisten?.();
    unlisten = undefined;
  }

  return { start, stop };
}
