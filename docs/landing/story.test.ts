import { afterEach, expect, it, vi } from "vitest";
import type { Thread } from "../../src/contract";
import { say } from "./session/speech";
import { type Recording, store } from "./session/thread-store";
import { currentPhase, startSession } from "./story";

const cast = vi.hoisted(() => {
  const marks = { ready: 1, answer: 2, final: 2.5, end: 3 };
  return {
    marks: vi.fn<typeof import("./session/cast").marks>(() => marks),
    readCast: vi.fn<typeof import("./session/cast").readCast>(() => ({
      castT: 0,
      playing: false,
      marks,
    })),
    playTo: vi.fn<typeof import("./session/cast").playTo>(),
    seek: vi.fn<typeof import("./session/cast").seek>(),
    switchTo: vi.fn<typeof import("./session/cast").switchTo>(),
  };
});
vi.mock("./session/cast", () => cast);
vi.mock("./character/body", () => ({
  readBody: vi.fn<typeof import("./character/body").readBody>(
    () => ({ state: "stand" }) as ReturnType<typeof import("./character/body").readBody>,
  ),
  startPeek: vi.fn<typeof import("./character/body").startPeek>(),
}));
vi.mock("./character/motion", () => ({ play: vi.fn<typeof import("./character/motion").play>() }));
vi.mock("./guide/steps", () => ({
  announce: vi.fn<typeof import("./guide/steps").announce>(),
  setStep: vi.fn<typeof import("./guide/steps").setStep>(),
}));
vi.mock("./session/speech", () => ({
  say: vi.fn<typeof import("./session/speech").say>(async () => {}),
}));
const dom = vi.hoisted(() => ({ listeners: new Map<string, () => void>(), added: [] as string[] }));
vi.mock("./shared/dom", () => {
  const el = (id: string) => ({
    addEventListener: (type: string, cb: () => void) => dom.listeners.set(`${id}:${type}`, cb),
    classList: { add: (name: string) => dom.added.push(`${id}.${name}`) },
  });
  return { $: el, grab: el("grab"), reduced: true, term: el("term") };
});
vi.mock("./voice", () => ({ soundBtn: { classList: { add() {} } } }));

const recorded = (ask: object) =>
  ({
    t: 0,
    threads: [
      {
        id: "cc",
        source: "claude-code",
        title: "acme-web",
        state: "input-required",
        entries: [{ role: "user", text: "run the tests", at: 0 }],
        created_at: 0,
        updated_at: 0,
        ask,
      },
    ],
  }) as unknown as Recording["snapshots"][number];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the replay on its path when the visitor answers the closing ask", async () => {
  vi.useFakeTimers();
  let thread: Thread | undefined;
  store.subscribe((s) => {
    thread = s.threads[0];
  });
  startSession();
  store.fromRecording(
    recorded({
      ask_id: "perm:1",
      prompt: "Allow Bash?",
      text: true,
      choices: [
        { id: "allow", label: "Allow" },
        { id: "deny", label: "Deny" },
      ],
    }),
    0,
  );
  await store.answer("cc", "perm:1", { choice: "allow" });
  store.fromRecording(recorded({ ask_id: "stop:1", prompt: "What next?", text: true }), 0);
  await store.answer("cc", "stop:1", { text: "open the PR" });
  expect(thread?.entries.at(-1)).toMatchObject({ role: "user", text: "open the PR" });
  expect(currentPhase()).toBe("speaking");
  await vi.advanceTimersByTimeAsync(900);
  expect(vi.mocked(say).mock.calls).toEqual([
    ["1,284 tests passed. Want me to open the PR for review?", "allow"],
  ]);
});

it("plays to the final snapshot, speaks the closing line, and Replay restarts the page", async () => {
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  startSession();
  await vi.waitFor(() => expect(currentPhase()).toBe("done"));
  expect(cast.playTo.mock.calls).toEqual([[2.5], [3]]);
  expect(vi.mocked(say).mock.calls.at(-1)).toEqual([
    "1,284 tests passed. Want me to open the PR for review?",
  ]);
  expect(dom.added).toContain("replay.on");
  dom.listeners.get("replay:click")?.();
  expect(reload).toHaveBeenCalledOnce();
});
