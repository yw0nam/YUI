import { describe, expect, it, vi } from "vitest";
import { createLaneQueue } from "./lane-queue";

function setup(cast = ["perlica", "natsume"]) {
  const drawn: string[] = [];
  const draw =
    (name: string) =>
    (...args: unknown[]) =>
      void drawn.push(args.length && typeof args[0] === "string" ? `${name}:${args[0]}` : name);
  const box = {
    beginSpeech: vi.fn(draw("begin")),
    pushSpeech: vi.fn(draw("push")),
    paceSpeech: vi.fn(draw("pace")),
    endSpeech: vi.fn(draw("end")),
    finishSpeech: vi.fn(draw("finish")),
    hideSpeech: vi.fn(draw("hide")),
    quoteUser: vi.fn(draw("quote")),
    quoteSignals: vi.fn(draw("quote-signals")),
    settleQuote: vi.fn(draw("settle-quote")),
    clearQuote: vi.fn(draw("clear-quote")),
  };
  const lanes = createLaneQueue({ box });
  lanes.setCast(cast);
  return { lanes, drawn, box };
}

describe("createLaneQueue", () => {
  it("buffers a second character's overlapping line and replays it once the first is done", () => {
    const { lanes, drawn } = setup();
    lanes.accept("perlica", { op: "begin" });
    lanes.accept("perlica", { op: "push", delta: "Hi." });
    lanes.accept("natsume", { op: "begin" });
    lanes.accept("natsume", { op: "push", delta: "Yo." });
    lanes.accept("perlica", { op: "end" });
    expect(drawn).toEqual(["begin", "push:Hi.", "end"]);
    expect(lanes.speaker()).toBe("perlica");
    expect(lanes.waiting("natsume")).toBe(true);

    lanes.allShown();

    expect(drawn).toEqual(["begin", "push:Hi.", "end", "begin", "push:Yo."]);
    expect(lanes.speaker()).toBe("natsume");
    expect(lanes.waiting("natsume")).toBe(false);
  });

  it("holds the box until the line both ended and showed whole", () => {
    const { lanes } = setup();
    lanes.accept("perlica", { op: "begin" });
    lanes.accept("natsume", { op: "begin" });

    lanes.allShown();
    expect(lanes.speaker()).toBe("perlica");

    lanes.accept("perlica", { op: "end" });
    expect(lanes.speaker()).toBe("perlica");
    lanes.allShown();
    expect(lanes.speaker()).toBe("natsume");
  });

  it("keeps a deferred line through a click-to-complete until its playback finishes", () => {
    const { lanes } = setup();
    lanes.accept("perlica", { op: "begin", paced: true });
    lanes.accept("natsume", { op: "begin" });
    lanes.accept("perlica", { op: "end", defer: true });

    lanes.allShown();
    expect(lanes.speaker()).toBe("perlica");

    lanes.accept("perlica", { op: "finish" });
    expect(lanes.speaker()).toBe("natsume");
  });

  it.each([
    "settle-quote",
    "clear-quote",
  ] as const)("hands the box on when a %s arrives with no line begun since the quote", (op) => {
    const { lanes, drawn } = setup();
    lanes.accept("perlica", { op: "quote", quote: { text: "hi", via: "text", images: 0 } });
    lanes.accept("natsume", { op: "begin" });

    lanes.accept("perlica", { op });

    expect(drawn).toEqual(["quote", op, "begin"]);
    expect(lanes.speaker()).toBe("natsume");
  });

  it("hands the box on when the box hides", () => {
    const { lanes } = setup();
    lanes.accept("perlica", { op: "begin" });
    lanes.accept("natsume", { op: "begin" });

    lanes.boxShown(false);

    expect(lanes.speaker()).toBe("natsume");
  });

  it("keeps the box for a character whose next line begins while it holds the box", () => {
    const { lanes } = setup();
    lanes.accept("perlica", { op: "begin" });
    lanes.accept("natsume", { op: "begin" });
    lanes.accept("perlica", { op: "end" });
    lanes.accept("perlica", { op: "begin" });

    lanes.allShown();

    expect(lanes.speaker()).toBe("perlica");
  });

  it("drops a quote the box was holding when the next character takes it", () => {
    const { lanes, drawn } = setup();
    lanes.accept("perlica", { op: "quote", quote: { text: "hi", via: "text", images: 0 } });
    lanes.accept("perlica", { op: "begin" });
    lanes.accept("natsume", { op: "begin" });
    lanes.accept("perlica", { op: "end" });

    lanes.allShown();

    expect(drawn.slice(-2)).toEqual(["clear-quote", "begin"]);
  });

  it("stopAll drops every line and hides the box", () => {
    const { lanes, drawn } = setup();
    lanes.accept("perlica", { op: "begin" });
    lanes.accept("natsume", { op: "begin" });

    lanes.stopAll();
    lanes.accept("natsume", { op: "push", delta: "late" });

    expect(drawn).toEqual(["begin", "hide"]);
    expect(lanes.speaker()).toBeNull();
    expect(lanes.waiting("natsume")).toBe(false);
  });

  it("drops the line of a character that leaves the cast", () => {
    const { lanes, drawn } = setup();
    lanes.accept("perlica", { op: "begin" });
    lanes.accept("natsume", { op: "begin" });

    lanes.setCast(["perlica"]);
    lanes.accept("perlica", { op: "end" });
    lanes.allShown();

    expect(drawn).toEqual(["begin", "end"]);
    expect(lanes.speaker()).toBeNull();
  });

  it("tells a subscriber each time the speaker changes", () => {
    const { lanes } = setup();
    const speakers: Array<string | null> = [];
    lanes.onSpeaker((preset) => speakers.push(preset));

    lanes.accept("perlica", { op: "begin" });
    lanes.accept("perlica", { op: "end" });
    lanes.allShown();

    expect(speakers).toEqual(["perlica", null]);
  });
});
