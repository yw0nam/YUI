/**
 * The unified chat window's view — every open preset's current-session transcript in one list,
 * and the composer that routes a message to one preset or, in sequence, to all of them.
 *
 * Draws what the transcripts record and carries the user's pick; the presets' backends decide
 * what to say (firing ≠ judgment).
 */

import type { UserTurnDone, UserTurnRouted } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale, t } from "../i18n";
import { ageText } from "../quick-controls/preset/relations/relation-glyph";
import { avatarEl, colorOf } from "./avatar";
import { createComposer } from "./composer";
import { mergeTranscripts, PENDING_MS, type PendingSend, type Row, type Transcript } from "./merge";
import { createSequence, lastSpeakerOf, targetsFor } from "./router";

const log = createLogger("unified-view");

export interface UnifiedView {
  refresh(): void;
  /** A pet window's user turn for a send id is over. */
  turnDone(done: UserTurnDone): void;
  onRoute(cb: (event: UserTurnRouted) => void): void;
  dispose(): void;
}

const ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>`;

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
      pending = pending.map((p) => (p.sendId === sendId ? { ...p, at: deps.now() } : p));
    },
  });
  const composer = createComposer({
    mount: root.querySelector<HTMLElement>(".yui-uc__dock")!,
    cast: deps.cast,
  });

  function entryOf(id: string, cast: PresetEntry[]): PresetEntry | undefined {
    return cast.find((c) => c.id === id);
  }

  function lineEl(row: Row, cast: PresetEntry[], now: number): HTMLElement {
    const li = document.createElement("li");
    li.className = "yui-uc__line";
    li.classList.toggle("is-pending", row.pending === true);
    const who = document.createElement("span");
    who.className = "yui-uc__who";
    const speaker = row.who === "user" ? undefined : entryOf(row.who, cast);
    if (speaker) {
      who.append(avatarEl(speaker, 20));
      who.style.color = colorOf(speaker.id);
    }
    who.append(row.who === "user" ? t("history.who_user") : row.name);
    const say = document.createElement("p");
    say.className = "yui-uc__say";
    if (row.to) {
      const to = document.createElement("span");
      to.className = "yui-uc__to";
      to.style.color = colorOf(row.to);
      to.innerHTML = ARROW;
      to.append(t("unified.marker", { name: entryOf(row.to, cast)?.name ?? row.to }));
      say.append(to);
    }
    say.append(row.text);
    if (row.pending) {
      const sr = document.createElement("span");
      sr.className = "yui-uc__sr";
      sr.textContent = t("unified.pending");
      say.append(sr);
    }
    const ago = document.createElement("time");
    ago.className = "yui-uc__ago";
    const ms = now - row.ts;
    ago.textContent = ms < 60_000 ? t("unified.just_now") : ageText(ms);
    li.append(who, say, ago);
    return li;
  }

  function refresh(): void {
    const now = deps.now();
    const cast = deps.cast();
    pending = pending.filter((p) => now - p.at < PENDING_MS);
    const rows = mergeTranscripts(deps.transcripts(), pending, now);

    title.textContent = t("unified.title");
    castEl.replaceChildren(
      ...cast.map((c) => {
        const li = document.createElement("li");
        li.className = "yui-uc__chip";
        li.append(avatarEl(c, 7), c.name);
        return li;
      }),
    );

    const atEnd = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 8;
    logEl.replaceChildren(...rows.map((r) => lineEl(r, cast, now)));
    if (atEnd) logEl.scrollTop = logEl.scrollHeight;

    const ids = cast.map((c) => c.id);
    const [fallback] = targetsFor({
      mention: null,
      cast: ids,
      lastSpeaker: lastSpeakerOf(rows),
      mainId: deps.mainId(),
      shuffle: shuffled,
    });
    composer.setTarget(fallback ? entryOf(fallback, cast) : undefined);

    // One timer for the earliest pending expiry, so the row leaves without another event.
    clearTimeout(expiry);
    const soonest = Math.min(...pending.map((p) => p.at + PENDING_MS));
    if (pending.length > 0) expiry = setTimeout(refresh, Math.max(soonest - now, 0) + 1);
  }

  composer.onSubmit((text) => {
    const cast = deps.cast();
    const picked = composer.getMention();
    const entry = picked && picked !== "everyone" ? entryOf(picked, cast) : undefined;
    const everyone = picked === "everyone";
    const mention = everyone ? "everyone" : entry ? "character" : undefined;
    const rows = mergeTranscripts(deps.transcripts(), pending, deps.now());
    const targets = targetsFor({
      mention: everyone ? "everyone" : (entry?.id ?? null),
      cast: cast.map((c) => c.id),
      lastSpeaker: lastSpeakerOf(rows),
      mainId: deps.mainId(),
      shuffle: shuffled,
    });
    if (cast.length === 0) return;
    const sendId = deps.randomId();
    const sent = everyone ? `@everyone ${text}` : entry ? `@${entry.name} ${text}` : text;
    pending.push({ sendId, text: sent, at: deps.now() });
    sequence.run({ sendId, targets, text: sent, ...(mention ? { mention } : {}) });
    composer.setMention(null);
    log.info("route", { targets: targets.length, mention: mention ?? "none" });
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
