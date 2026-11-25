import { afterEach, expect, it, vi } from "vitest";
import { say } from "./session/speech";
import { currentPhase, startSession } from "./story";

const cast = vi.hoisted(() => {
  const marks = { ready: 1, final: 2.5, end: 3 };
  return {
    marks: vi.fn<typeof import("./session/cast").marks>(() => marks),
    readCast: vi.fn<typeof import("./session/cast").readCast>(() => ({ castT: 0, playing: false })),
    playTo: vi.fn<typeof import("./session/cast").playTo>(async () => {}),
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

afterEach(() => vi.unstubAllGlobals());

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
