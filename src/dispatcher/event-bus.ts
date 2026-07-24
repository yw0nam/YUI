/**
 * Event bus — single collection point for all speech candidate events.
 *
 * Queue policy:
 *  - Data structure: priority heap, key = (tier ASC, ts ASC), same tier FIFO (insertion order).
 *  - Capacity 100. Exceeding drops lowest-priority items first + onDrop callback/log.
 *  - Bus drop conditions: schema invalid / unknown event_name / ts ±60s out of window.
 *
 * Priority (lower = earlier): user.* (0) < backend.push.* (1) <
 *   idle.* · time_milestone.* (2) < os.* (3) < internal (4).
 *
 * This module only collects firing + sorts — final tier decision/routing is dispatcher responsibility.
 */

/** event_bus envelope. seq_id assigned by bus. */
export interface BusEnvelope {
  /** Assigned by bus (monotonic). May be empty at push time. */
  seq_id?: number;
  source:
    | "timer_scheduler"
    | "idle_watcher"
    | "os_event_watcher"
    | "user_input_source"
    | "backend_push_source";
  /** event_name. ex: "time_milestone.morning". */
  event_name: string;
  /** client epoch ms. */
  ts: number;
  payload?: Record<string, unknown>;
  /** Source-estimated tier. Dispatcher makes final decision. */
  hint_tier?: 1 | 2 | 3;
  /** True only for user-initiated (DND/debounce bypass). */
  dnd_override?: boolean;
}

/** bus-drop / capacity-drop classification. */
type BusDropReason =
  | "schema_invalid"
  | "unknown_event_name"
  | "ts_out_of_window"
  | "capacity_overflow";

interface EventBusOptions {
  /** Callback on drop (dev logging/observation). */
  onDrop?: (env: BusEnvelope, reason: BusDropReason) => void;
  /** Queue capacity. default 100. */
  capacity?: number;
  /** ts allowed window (ms). default 60_000 (±60s). */
  tsWindowMs?: number;
}

export interface EventBus {
  /** Push event to queue. After validation passes, assign seq_id and return true. false if dropped. */
  push(env: BusEnvelope): boolean;
  /** Dispatcher removes next target (tier ASC, ts ASC, FIFO). null if empty. */
  pop(): BusEnvelope | null;
  /** Current queue snapshot (unsorted raw array, dev inspection). */
  snapshot(): BusEnvelope[];
}

/**
 * event_name → priority. Lower = pop earlier.
 * Unknown prefix bus-drops as unknown_event_name, doesn't reach here.
 */
const KNOWN_PREFIXES: ReadonlyArray<{ prefix: string; priority: number }> = [
  { prefix: "user.", priority: 0 },
  { prefix: "backend.push.", priority: 1 },
  { prefix: "idle.", priority: 2 },
  { prefix: "time_milestone.", priority: 2 },
  { prefix: "proactive.", priority: 2 },
  { prefix: "schedule.", priority: 2 },
  { prefix: "agent.", priority: 2 },
  { prefix: "signals.", priority: 2 },
  { prefix: "periodic_tick", priority: 4 },
  { prefix: "os.", priority: 3 },
];

function priorityOf(eventName: string): number | null {
  for (const { prefix, priority } of KNOWN_PREFIXES) {
    if (eventName.startsWith(prefix) || eventName === prefix) return priority;
  }
  return null;
}

const VALID_SOURCES = new Set<BusEnvelope["source"]>([
  "timer_scheduler",
  "idle_watcher",
  "os_event_watcher",
  "user_input_source",
  "backend_push_source",
]);

interface QueueItem {
  env: BusEnvelope;
  priority: number;
  /** Insertion order (ensures same priority+ts FIFO). */
  seq: number;
}

/**
 * Sort comparison: priority ASC → ts ASC → seq ASC (FIFO).
 * Return < 0 if a pops before b.
 */
function compare(a: QueueItem, b: QueueItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.env.ts !== b.env.ts) return a.env.ts - b.env.ts;
  return a.seq - b.seq;
}

export function createEventBus(opts: EventBusOptions = {}): EventBus {
  const capacity = opts.capacity ?? 100;
  const tsWindowMs = opts.tsWindowMs ?? 60_000;
  const onDrop = opts.onDrop;

  // Simple sorted array — for capacity 100, clearer and fast enough vs binary-heap.
  // Sort invariant maintained at push/pop.
  const items: QueueItem[] = [];
  let nextSeqId = 1;
  let insertCounter = 0;

  function drop(env: BusEnvelope, reason: BusDropReason): false {
    onDrop?.(env, reason);
    return false;
  }

  function validate(env: BusEnvelope): BusDropReason | null {
    if (
      env == null ||
      typeof env !== "object" ||
      typeof env.event_name !== "string" ||
      env.event_name.length === 0 ||
      typeof env.ts !== "number" ||
      !Number.isFinite(env.ts) ||
      !VALID_SOURCES.has(env.source)
    ) {
      return "schema_invalid";
    }
    if (priorityOf(env.event_name) == null) return "unknown_event_name";
    const now = Date.now();
    if (Math.abs(env.ts - now) > tsWindowMs) return "ts_out_of_window";
    return null;
  }

  return {
    push(env) {
      const invalid = validate(env);
      if (invalid) return drop(env, invalid);

      const priority = priorityOf(env.event_name)!;
      env.seq_id = nextSeqId++;
      const item: QueueItem = { env, priority, seq: insertCounter++ };

      // Maintain sort after insertion (small N — insertion-sort level).
      items.push(item);
      items.sort(compare);

      // Exceed capacity → drop 1 item with lowest priority (=end of sort).
      if (items.length > capacity) {
        const evicted = items.pop()!;
        drop(evicted.env, "capacity_overflow");
      }
      return true;
    },

    pop() {
      const item = items.shift();
      return item ? item.env : null;
    },

    snapshot() {
      return items.map((it) => it.env);
    },
  };
}
