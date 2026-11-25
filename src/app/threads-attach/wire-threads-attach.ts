/**
 * Main's attached Threads: the Threads window's toggles and the chips' × change them, every composer
 * draws them, a send drops the ones it carried, and the Threads window hears each change.
 */

import { publishState } from "../../io/bridge/core/state-mirror";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { type AttachedThreads, createAttachedThreads } from "./attached-threads";

export function wireThreadsAttach(deps: {
  bridge: Pick<
    SettingsBridge,
    "onThreadsAttachRequest" | "emitThreadsAttached" | "onThreadsReady" | "onUserTurnRouted"
  >;
  surfaces: Pick<
    Surfaces,
    "setThreads" | "onThreadRemove" | "onSubmit" | "summonInput" | "isInputOpen"
  >;
  /** Main's preset id: a unified chat message routed here drops the Threads it carried. */
  selfPresetId: string;
  register: (dispose: () => void) => void;
}): Pick<AttachedThreads, "restore"> {
  const { bridge, surfaces, register } = deps;
  const attached = createAttachedThreads();
  register(attached.subscribe(surfaces.setThreads));
  register(
    publishState({
      get: attached.get,
      subscribe: attached.subscribe,
      emit: (threads) => bridge.emitThreadsAttached({ threads }),
      onAsk: bridge.onThreadsReady,
    }),
  );
  register(
    bridge.onThreadsAttachRequest(({ op, thread }) => {
      if (op === "remove") attached.drop([thread]);
      else if (attached.toggle(thread) && !surfaces.isInputOpen()) surfaces.summonInput();
    }),
  );
  surfaces.onThreadRemove((thread) => attached.drop([thread]));
  surfaces.onSubmit((_text, _images, threads) => attached.drop(threads));
  register(
    bridge.onUserTurnRouted(({ to, threads }) => {
      if (to === deps.selfPresetId && threads) attached.drop(threads);
    }),
  );
  return { restore: attached.restore };
}
