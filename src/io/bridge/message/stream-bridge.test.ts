import { describe, expect, it } from "vitest";
import type { SpeechStream } from "../settings-bridge";
import { createRemoteSurfaces } from "./message-remote";
import { createStreamBridge } from "./stream-bridge";

function setup() {
  const asks = new Set<() => void>();
  const emitted: SpeechStream[] = [];
  const remote = createRemoteSurfaces(
    createStreamBridge({
      presetId: "yui",
      settingsBridge: {
        emitSpeechStream: (event) => void emitted.push(event),
        onSpeechStreamAsk: (cb) => {
          asks.add(cb);
          return () => asks.delete(cb);
        },
      },
    }),
  );
  return {
    remote,
    emitted,
    ask: () => {
      for (const cb of asks) cb();
    },
  };
}

describe("createStreamBridge", () => {
  it("stamps each op the remote sends with its preset", () => {
    const { remote, emitted } = setup();

    remote.beginSpeech(undefined, { paced: true });

    expect(emitted).toEqual([{ preset: "yui", op: { op: "begin", paced: true } }]);
  });

  it("answers an ask with the name and the busy state", () => {
    const { remote, emitted, ask } = setup();
    remote.setName("Yui");
    remote.setBusy(true);
    emitted.length = 0;

    ask();

    expect(emitted).toEqual([
      { preset: "yui", op: { op: "name", name: "Yui" } },
      { preset: "yui", op: { op: "busy", busy: true } },
    ]);
  });
});
