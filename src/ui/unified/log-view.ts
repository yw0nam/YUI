import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import type { createComposer } from "./composer";
import { castChipEl, lineEl } from "./log-rows";
import { mergeTranscripts, type PendingSend, type Transcript } from "./merge";
import { SEND_TIMEOUT_MS } from "./sequence";
import { fallbackTarget, lastSpeakerOf } from "./targets";

export function createLogView(deps: {
  root: HTMLElement;
  cast: () => PresetEntry[];
  transcripts: () => Transcript[];
  mainId: () => string;
  now: () => number;
  composer: Pick<ReturnType<typeof createComposer>, "setTarget">;
}) {
  const title = deps.root.querySelector<HTMLElement>(".yui-uc__title")!;
  const castEl = deps.root.querySelector<HTMLElement>(".yui-uc__cast")!;
  const logEl = deps.root.querySelector<HTMLElement>(".yui-uc__log")!;
  const composer = deps.composer;
  let pending: PendingSend[] = [];
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function refresh(): void {
    const now = deps.now();
    const cast = deps.cast();
    pending = pending.filter((p) => p.queued || now - p.at < SEND_TIMEOUT_MS);
    const transcripts = deps.transcripts();
    const rows = mergeTranscripts(transcripts, pending, now);

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

    clearTimeout(expiry);
    const deadlines = pending.filter((p) => !p.queued).map((p) => p.at + SEND_TIMEOUT_MS);
    if (deadlines.length > 0) {
      const soonest = Math.min(...deadlines);
      expiry = setTimeout(refresh, Math.max(soonest - now, 0) + 1);
    }
  }

  return {
    refresh,
    addSend(sendId: string, text: string): void {
      pending.push({ sendId, text, at: deps.now(), queued: true });
    },
    startSend(sendId: string): void {
      pending = pending.map((p) =>
        p.sendId === sendId ? { sendId, text: p.text, at: deps.now() } : p,
      );
    },
    lastSpeaker(): string | undefined {
      return lastSpeakerOf(mergeTranscripts(deps.transcripts(), pending, deps.now()));
    },
    dispose(): void {
      clearTimeout(expiry);
    },
  };
}
