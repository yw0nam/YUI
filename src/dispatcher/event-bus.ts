/**
 * Event bus — 모든 발화 후보 event의 단일 수집 지점.
 *
 * 큐 정책:
 *  - 자료구조: priority heap, key = (tier ASC, ts ASC), 동일 tier FIFO(삽입순).
 *  - 용량 100. 초과 시 우선순위 가장 낮은 항목부터 drop + onDrop 콜백/로그.
 *  - Bus drop 조건: schema invalid / 미지의 event_name / ts ±60s 벗어남.
 *
 * 우선순위(낮을수록 우선): user.* (0) < backend.push.* (1) <
 *   idle.* · time_milestone.* (2) < os.* (3) < internal (4).
 *
 * 본 모듈은 firing 채집 + 정렬만 한다 — tier 최종 결정/라우팅은 dispatcher 책임.
 */

/** event_bus envelope. seq_id는 bus가 부여. */
export interface BusEnvelope {
  /** bus가 부여 (monotonic). push 시점엔 비어 있어도 됨. */
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
  /** source 추정 tier. dispatcher가 최종 결정. */
  hint_tier?: 1 | 2 | 3;
  /** user-initiated만 true (DND/debounce 우회). */
  dnd_override?: boolean;
}

/** bus-drop / capacity-drop 분류. */
export type BusDropReason =
  | "schema_invalid"
  | "unknown_event_name"
  | "ts_out_of_window"
  | "capacity_overflow";

export interface EventBusOptions {
  /** drop 발생 시 콜백 (dev 로깅/관찰). */
  onDrop?: (env: BusEnvelope, reason: BusDropReason) => void;
  /** 큐 용량. default 100. */
  capacity?: number;
  /** ts 허용 윈도우(ms). default 60_000 (±60s). */
  tsWindowMs?: number;
}

export interface EventBus {
  /** event를 큐에 push. 검증 통과 시 seq_id 부여 후 true. drop이면 false. */
  push(env: BusEnvelope): boolean;
  /** dispatcher가 다음 처리 대상을 꺼냄 (tier ASC, ts ASC, FIFO). 비면 null. */
  pop(): BusEnvelope | null;
  /** 현재 큐 스냅샷 (정렬되지 않은 raw 배열, dev inspection). */
  snapshot(): BusEnvelope[];
}

/**
 * event_name → 우선순위 priority. 낮을수록 먼저 pop.
 * 미지의 prefix는 unknown_event_name으로 bus-drop되므로 여기 도달하지 않는다.
 */
const KNOWN_PREFIXES: ReadonlyArray<{ prefix: string; priority: number }> = [
  { prefix: "user.", priority: 0 },
  { prefix: "backend.push.", priority: 1 },
  { prefix: "idle.", priority: 2 },
  { prefix: "time_milestone.", priority: 2 },
  { prefix: "proactive.", priority: 2 },
  { prefix: "schedule.", priority: 2 },
  { prefix: "github.", priority: 2 },
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
  /** 삽입 순서(동일 priority+ts FIFO 보장). */
  seq: number;
}

/**
 * 정렬 비교: priority ASC → ts ASC → seq ASC(FIFO).
 * 반환 < 0 이면 a가 b보다 먼저 pop.
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

  // 단순 정렬 배열 — 용량 100 규모에선 binary-heap보다 명료하고 충분히 빠르다.
  // 정렬 불변식은 push/pop 시점에 유지한다.
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

      // 삽입 후 정렬 유지(작은 N — 삽입정렬 수준).
      items.push(item);
      items.sort(compare);

      // 용량 초과 → 우선순위 가장 낮은(=정렬 끝) 1건 drop.
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
