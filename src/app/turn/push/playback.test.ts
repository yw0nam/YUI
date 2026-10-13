import { describe, expect, it, vi } from "vitest";
import type { PreviousTurn } from "../../../contract";
import type { PlaybackFrame } from "../../../io/chat/push/push-frames";
import { wirePlayback } from "./playback";

function recordsSource() {
  const listeners = new Set<(record: PreviousTurn) => void>();
  return {
    subscribe(cb: (record: PreviousTurn) => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    save(record: PreviousTurn) {
      for (const cb of listeners) cb(record);
    },
    count: () => listeners.size,
  };
}

const record: PreviousTurn = {
  turn_id: "7",
  event_name: "agent.done",
  ended: "interrupted",
  ts: 123,
  spoken: "Heard.",
  unspoken: "Owed.",
};

describe("wirePlayback", () => {
  it("one store save sends one playback frame and dispose unsubscribes", () => {
    const previousTurn = recordsSource();
    const socket = { sendPlayback: vi.fn(() => true) };
    const dispose = wirePlayback({ socket, previousTurn });
    previousTurn.save(record);
    expect(socket.sendPlayback).toHaveBeenCalledExactlyOnceWith({
      type: "playback",
      turn_id: "7",
      ended: "interrupted",
      spoken: "Heard.",
      unspoken: "Owed.",
    });
    dispose();
    expect(previousTurn.count()).toBe(0);
    previousTurn.save(record);
    expect(socket.sendPlayback).toHaveBeenCalledTimes(1);
  });

  it("does not replay rejected disconnected saves and omits records without identity", () => {
    const previousTurn = recordsSource();
    const frames: PlaybackFrame[] = [];
    let ready = false;
    const socket = {
      sendPlayback: vi.fn((frame: PlaybackFrame) => {
        if (!ready) return false;
        frames.push(frame);
        return true;
      }),
    };
    const dispose = wirePlayback({ socket, previousTurn });
    previousTurn.save(record);
    expect(frames).toEqual([]);
    ready = true;
    previousTurn.save({ event_name: "agent.done", ended: "failed", ts: 123 });
    expect(frames).toEqual([]);
    previousTurn.save({ ...record, ended: "complete", spoken: undefined, unspoken: undefined });
    expect(frames).toEqual([{ type: "playback", turn_id: "7", ended: "complete" }]);
    expect(socket.sendPlayback).toHaveBeenCalledTimes(2);
    dispose();
  });
});
