import { expect, it, vi } from "vitest";
import { createSpeechStream } from "./speech-stream";

it("emits identified speech with its preset and ignores unidentified operations", () => {
  const emit = vi.fn();
  const stream = createSpeechStream({ presetId: "perlica", emit, readTranscript: () => [] });
  stream.beginSpeech();
  stream.pushSpeech("Wait.");
  stream.endSpeech({ defer: true });
  expect(emit.mock.calls).toEqual([]);
  const identity = { turn_id: "7", event_name: "user.text_submitted" };
  stream.beginSpeech(identity);
  stream.pushSpeech("Hello", identity);
  stream.endSpeech({ defer: true }, identity);
  expect(emit.mock.calls).toEqual([
    [{ preset: "perlica", turn_id: "7", op: "begin", baseline: 0 }],
    [{ preset: "perlica", turn_id: "7", op: "push", delta: "Hello" }],
    [{ preset: "perlica", turn_id: "7", op: "end" }],
  ]);
});

it("captures the matching assistant record count at each begin in the pet window", () => {
  const emit = vi.fn();
  const entries = [
    { role: "assistant" as const, turn_id: "7", text: "First", ts: 1 },
    { role: "assistant" as const, turn_id: "8", text: "Other turn", ts: 2 },
    { role: "user" as const, turn_id: "7", text: "User", ts: 3 },
  ];
  const stream = createSpeechStream({ presetId: "perlica", emit, readTranscript: () => entries });
  const identity = { turn_id: "7", event_name: "user.text_submitted" };
  stream.beginSpeech(identity);
  entries.push({ role: "assistant", turn_id: "7", text: "Second", ts: 4 });
  stream.beginSpeech(identity);
  expect(emit.mock.calls).toEqual([
    [{ preset: "perlica", turn_id: "7", op: "begin", baseline: 1 }],
    [{ preset: "perlica", turn_id: "7", op: "begin", baseline: 2 }],
  ]);
});
