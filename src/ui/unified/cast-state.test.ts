import { describe, expect, it } from "vitest";
import { createCastState } from "./cast-state";

function setup(lane: { speaker?: string; waiting?: string } = {}) {
  let cast = [
    { id: "perlica", name: "Perlica" },
    { id: "natsume", name: "Natsume" },
  ];
  const state = createCastState({
    cast: () => cast,
    lanes: { speaker: () => lane.speaker ?? null, waiting: (id) => id === lane.waiting },
  });
  return { state, setCast: (next: typeof cast) => (cast = next) };
}

describe("createCastState", () => {
  it.each([
    [{ speaker: "perlica" }, false, "talk"],
    [{}, true, "think"],
    [{ waiting: "perlica" }, false, "think"],
    [{}, false, "idle"],
  ] as const)("reads %j with busy %s as %s", (lane, busy, expected) => {
    const { state } = setup(lane);
    state.setBusy("perlica", busy);

    expect(state.stateOf("perlica")).toBe(expected);
  });

  it("runs while a line holds or waits for the box or a turn runs, and forgets a preset that left", () => {
    expect(setup({ speaker: "natsume" }).state.running()).toBe(true);
    expect(setup({ waiting: "natsume" }).state.running()).toBe(true);
    const { state, setCast } = setup();
    state.setBusy("natsume", true);
    expect(state.running()).toBe(true);

    setCast([{ id: "perlica", name: "Perlica" }]);
    state.prune();
    setCast([
      { id: "perlica", name: "Perlica" },
      { id: "natsume", name: "Natsume" },
    ]);

    expect(state.running()).toBe(false);
  });

  it("names a preset by what its window sent, else by the registry", () => {
    const { state } = setup();
    state.setName("natsume", "Natsu");

    expect([state.nameOf("natsume"), state.nameOf("perlica")]).toEqual(["Natsu", "Perlica"]);
  });
});
