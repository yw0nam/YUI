import { expect, it, vi } from "vitest";
import { createSpeechStream } from "./speech-stream";

it("emits identified speech with its preset and ignores unidentified operations", () => {
  const emit = vi.fn();
  const stream = createSpeechStream({ presetId: "perlica", emit });
  stream.beginSpeech();
  stream.pushSpeech("Wait.");
  stream.endSpeech({ defer: true });
  expect(emit.mock.calls).toEqual([]);
  const identity = { turn_id: "7", event_name: "user.text_submitted" };
  stream.beginSpeech(identity);
  stream.pushSpeech("Hello", identity);
  stream.endSpeech({ defer: true }, identity);
  expect(emit.mock.calls).toEqual([
    [{ preset: "perlica", turn_id: "7", op: "begin" }],
    [{ preset: "perlica", turn_id: "7", op: "push", delta: "Hello" }],
    [{ preset: "perlica", turn_id: "7", op: "end" }],
  ]);
});
