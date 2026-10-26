import { describe, expect, it, vi } from "vitest";
import type { SpeechStream, SpeechStreamControl } from "../settings-bridge";
import { createRemoteSurfaces } from "./message-remote";
import { createStreamBridge } from "./stream-bridge";

function setup() {
  const asks = new Set<() => void>();
  const controls = new Set<(event: SpeechStreamControl) => void>();
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
        onSpeechStreamControl: (cb) => {
          controls.add(cb);
          return () => controls.delete(cb);
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
    control: (event: SpeechStreamControl) => {
      for (const cb of controls) cb(event);
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

  it("runs an error's fix when the unified window's click names this preset", () => {
    const { remote, control } = setup();
    const onClick = vi.fn();
    remote.showInputError("Connect a backend first.", { label: "Open Connection", onClick });

    control({ preset: "other", op: { op: "input-error-action" } });
    expect(onClick).not.toHaveBeenCalled();
    control({ preset: "yui", op: { op: "input-error-action" } });

    expect(onClick).toHaveBeenCalledOnce();
  });
});
