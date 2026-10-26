/**
 * The unified chat window wires every open preset's log, running replies, composer and one-at-a-time
 * routing. Firing ≠ judgment: the presets' backends decide whether and what to say; the view renders it.
 */

import type { UserTurnDone, UserTurnRouted } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale } from "../i18n";
import { createComposer } from "./composer";
import { createLogView } from "./log-view";
import type { Transcript } from "./merge";
import { createSequence } from "./sequence";
import { buildSend } from "./targets";

const log = createLogger("unified-view");

export interface UnifiedView {
  refresh(): void;
  /** A pet window's user turn for a send id is over. */
  turnDone(done: UserTurnDone): void;
  onRoute(cb: (event: UserTurnRouted) => void): void;
  dispose(): void;
}

function shuffled(ids: string[]): string[] {
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

export function createUnifiedView(deps: {
  mount: HTMLElement;
  cast: () => PresetEntry[];
  transcripts: () => Transcript[];
  mainId: () => string;
  now: () => number;
  randomId: () => string;
}): UnifiedView {
  const root = document.createElement("div");
  root.className = "yui-uc";
  root.innerHTML = `
    <header class="yui-uc__head"><h1 class="yui-uc__title"></h1><ul class="yui-uc__cast"></ul></header>
    <ol class="yui-uc__log"></ol>
    <div class="yui-uc__dock"></div>`;
  deps.mount.append(root);
  const routeCbs: Array<(event: UserTurnRouted) => void> = [];
  const composer = createComposer({
    mount: root.querySelector<HTMLElement>(".yui-uc__dock")!,
    cast: deps.cast,
  });
  const logView = createLogView({ ...deps, root, composer });
  const sequence = createSequence({
    emit: (event) => {
      for (const cb of routeCbs) cb(event);
    },
    onStart: logView.startSend,
  });

  composer.onSubmit((text) => {
    const send = buildSend({
      text,
      mention: composer.getMention(),
      cast: deps.cast(),
      lastSpeaker: logView.lastSpeaker(),
      mainId: deps.mainId(),
      shuffle: shuffled,
      sendId: deps.randomId(),
    });
    if (!send) return;
    logView.addSend(send.sendId, send.text);
    sequence.run(send);
    composer.setMention(null);
    log.info("route", { targets: send.targets.length, mention: send.mention ?? "none" });
    logView.refresh();
  });

  const unsubscribeLocale = subscribeLocale(logView.refresh);

  return {
    refresh: logView.refresh,
    turnDone: sequence.turnDone,
    onRoute: (cb) => void routeCbs.push(cb),
    dispose() {
      logView.dispose();
      unsubscribeLocale();
      sequence.dispose();
      composer.dispose();
      root.remove();
    },
  };
}
