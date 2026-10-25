/**
 * The unified chat window's view — every open preset's current-session transcript in one list,
 * and the composer that routes a message to one preset or, in sequence, to all of them.
 *
 * Wires the modules and keeps the pending sends with their expiry timer; the presets' backends
 * decide what to say (firing ≠ judgment).
 */

import type { UserTurnDone, UserTurnRouted } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale, t } from "../i18n";
import { createComposer } from "./composer";
import { castChipEl, lineEl } from "./log-rows";
import { mergeTranscripts, type PendingSend, type Transcript } from "./merge";
import { createSequence, SEND_TIMEOUT_MS } from "./sequence";
import { buildSend, fallbackTarget, lastSpeakerOf } from "./targets";

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
  const title = root.querySelector<HTMLElement>(".yui-uc__title")!;
  const castEl = root.querySelector<HTMLElement>(".yui-uc__cast")!;
  const logEl = root.querySelector<HTMLElement>(".yui-uc__log")!;

  let pending: PendingSend[] = [];
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const routeCbs: Array<(event: UserTurnRouted) => void> = [];
  const sequence = createSequence({
    emit: (event) => {
      for (const cb of routeCbs) cb(event);
    },
    // The clock of a send that waited in the queue starts when it is sent.
    onStart: (sendId) => {
      pending = pending.map((p) =>
        p.sendId === sendId ? { sendId, text: p.text, at: deps.now() } : p,
      );
    },
  });
  const composer = createComposer({
    mount: root.querySelector<HTMLElement>(".yui-uc__dock")!,
    cast: deps.cast,
  });

  function refresh(): void {
    const now = deps.now();
    const cast = deps.cast();
    pending = pending.filter((p) => p.queued || now - p.at < SEND_TIMEOUT_MS);
    const rows = mergeTranscripts(deps.transcripts(), pending, now);

    title.textContent = t("unified.title");
    castEl.replaceChildren(...cast.map(castChipEl));

    const atEnd = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 8;
    logEl.replaceChildren(...rows.map((r) => lineEl(r, cast, now)));
    if (atEnd) logEl.scrollTop = logEl.scrollHeight;

    const target = fallbackTarget({
      cast: cast.map((c) => c.id),
      lastSpeaker: lastSpeakerOf(rows),
      mainId: deps.mainId(),
    });
    composer.setTarget(cast.find((c) => c.id === target));

    // One timer for the earliest pending expiry, so the row leaves without another event.
    clearTimeout(expiry);
    const running = pending.filter((p) => !p.queued);
    if (running.length > 0) {
      const soonest = Math.min(...running.map((p) => p.at + SEND_TIMEOUT_MS));
      expiry = setTimeout(refresh, Math.max(soonest - now, 0) + 1);
    }
  }

  composer.onSubmit((text) => {
    const send = buildSend({
      text,
      mention: composer.getMention(),
      cast: deps.cast(),
      lastSpeaker: lastSpeakerOf(mergeTranscripts(deps.transcripts(), pending, deps.now())),
      mainId: deps.mainId(),
      shuffle: shuffled,
      sendId: deps.randomId(),
    });
    if (!send) return;
    pending.push({ sendId: send.sendId, text: send.text, at: deps.now(), queued: true });
    sequence.run(send);
    composer.setMention(null);
    log.info("route", { targets: send.targets.length, mention: send.mention ?? "none" });
    refresh();
  });

  const unsubscribeLocale = subscribeLocale(refresh);

  return {
    refresh,
    turnDone: sequence.turnDone,
    onRoute: (cb) => void routeCbs.push(cb),
    dispose() {
      clearTimeout(expiry);
      unsubscribeLocale();
      sequence.dispose();
      composer.dispose();
      root.remove();
    },
  };
}
