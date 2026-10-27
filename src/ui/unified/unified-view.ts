/**
 * The unified chat window: the cast row, one dialogue box that shows one character's line at a
 * time, and the composer with one-at-a-time routing. Firing ≠ judgment: the presets' backends
 * decide whether and what to say; the view renders what their windows stream.
 */

import type { SpeechStream, UserTurnDone, UserTurnRouted } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale } from "../i18n";
import { createSurfaces } from "../surfaces/surfaces";
import { backlogLines, recipientName, shownQuote, youTo } from "./backlog-lines";
import { createCastChips } from "./cast-chips";
import { createCastState } from "./cast-state";
import { createComposer } from "./composer";
import { createLaneQueue } from "./lane-queue";
import { mergeTranscripts, type PendingSend, type Transcript } from "./merge";
import { createSequence, SEND_TIMEOUT_MS } from "./sequence";
import {
  buildSend,
  EVERYONE,
  fallbackTarget,
  lastSpeakerOf,
  type Mention,
  recipientOf,
} from "./targets";

const log = createLogger("unified-view");

export interface UnifiedView {
  /** The window's column; the window takes its height. */
  readonly el: HTMLElement;
  refresh(): void;
  /** One op a pet window streamed. */
  speechStream(event: SpeechStream): void;
  /** A pet window's user turn for a send id is over. */
  turnDone(done: UserTurnDone): void;
  /** Main's recognized speech: routed like a typed message, or put in the field while any turn runs
   * or a line holds or waits for the box. */
  voiceSegment(text: string): void;
  /** The user started speaking: while any turn runs or a line holds or waits for the box, the stop
   * button's path. */
  speechOnset(): void;
  /** Another window's stop: ends the send under way and the lines, sending no stop of its own. */
  stop(): void;
  onRoute(cb: (event: UserTurnRouted) => void): void;
  /** The stop button: every pet window stops its running turn. */
  onStop(cb: () => void): void;
  /** A click on an error's fix, for the preset whose window showed the error. */
  onInputErrorAction(cb: (preset: string) => void): void;
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
  /** Takes OS focus, so typing lands in this window's field. */
  focusWindow: () => Promise<void>;
  closeWindow: () => void;
  startDragging: () => void;
}): UnifiedView {
  const root = document.createElement("div");
  root.className = "yui-uc";
  deps.mount.append(root);
  const routeCbs: Array<(event: UserTurnRouted) => void> = [];
  const stopCbs: Array<() => void> = [];
  const errorActionCbs: Array<(preset: string) => void> = [];
  let pending: PendingSend[] = [];

  const entryOf = (id: string): PresetEntry | undefined => deps.cast().find((e) => e.id === id);
  const nameOf = (id: string): string => castState.nameOf(id);
  const rows = () => {
    const now = deps.now();
    pending = pending.filter((p) => p.queued || now - p.at < SEND_TIMEOUT_MS);
    return mergeTranscripts(deps.transcripts(), pending, now);
  };

  const chips = createCastChips({
    mount: root,
    onClose: deps.closeWindow,
    startDragging: deps.startDragging,
    onPick: (id) => composer.setMention(id),
    focusField: () => composer.focus(),
  });
  const boxMount = document.createElement("div");
  boxMount.className = "yui-uc__box";
  const dock = document.createElement("div");
  dock.className = "yui-uc__dock";
  root.append(boxMount, dock);

  const box = createSurfaces({
    mount: boxMount,
    tool: { showTool() {}, finishTool() {}, hideTool() {} },
    namePlate: true,
    keepBubbleUntilDismissed: () => false,
    backlog: { read: () => backlogLines(rows(), nameOf, deps.cast()) },
    onAllShown: () => lanes.allShown(),
    onShown: (shown) => lanes.boxShown(shown),
    quoteLead: (quote) =>
      youTo(quote.mention === EVERYONE ? EVERYONE : (lanes.speaker() ?? ""), nameOf),
  });
  box.el.classList.add("yui-ui--message");
  const lanes = createLaneQueue({ box });
  const castState = createCastState({ cast: deps.cast, lanes });
  const composer = createComposer({ mount: dock, cast: deps.cast });
  const sequence = createSequence({
    emit: (event) => {
      for (const cb of routeCbs) cb(event);
    },
    onStart: (sendId) => {
      pending = pending.map((p) =>
        p.sendId === sendId ? { sendId, text: p.text, to: p.to, at: deps.now() } : p,
      );
    },
    onIdle: () => paint(),
  });

  function busy(): boolean {
    return castState.running() || sequence.current() !== null;
  }

  // The recipient the row and the placeholder name: a pick or typed @name, else the running send's, else the fallback.
  function shown(): Mention | undefined {
    const send = sequence.current();
    return (
      composer.getExplicitMention() ??
      (send
        ? recipientOf(send)
        : fallbackTarget({
            cast: deps.cast().map((e) => e.id),
            lastSpeaker: lastSpeakerOf(rows()),
            mainId: deps.mainId(),
          }))
    );
  }

  function paint(): void {
    const recipient = shown();
    chips.render(deps.cast(), castState.stateOf, recipient);
    composer.showRecipient(
      recipient === undefined || deps.cast().length === 0
        ? undefined
        : recipientName(recipient, nameOf),
    );
    composer.setBusy(busy());
  }

  lanes.onSpeaker((preset) => {
    const entry = preset === null ? undefined : entryOf(preset);
    if (preset !== null) box.plate.setName(nameOf(preset));
    if (entry) box.plate.setFace(entry);
    paint();
  });

  function refresh(): void {
    castState.prune();
    lanes.setCast(deps.cast().map((e) => e.id));
    composer.refreshCast();
    paint();
  }

  function route(text: string, via?: UserTurnRouted["via"]): void {
    // A spoken send names the pick or a typed @name; the fallback picks the target as for a typed send.
    const send = buildSend({
      text,
      mention: via ? composer.getExplicitMention() : composer.getMention(),
      cast: deps.cast(),
      lastSpeaker: lastSpeakerOf(rows()),
      mainId: deps.mainId(),
      shuffle: shuffled,
      sendId: deps.randomId(),
    });
    if (!send) return;
    pending.push({
      sendId: send.sendId,
      text: send.text,
      to: recipientOf(send),
      at: deps.now(),
      queued: true,
    });
    sequence.run({ ...send, via });
    // A picked chip is cleared by the send; a typed @name leaves the field only when the send used it.
    if (via && composer.getMention() === null) composer.consumeMentionToken();
    composer.setMention(null);
    log.info("route", {
      targets: send.targets.length,
      mention: send.mention ?? "none",
      via: via ?? "text",
    });
    paint();
  }

  function stop(): void {
    sequence.cancel();
    lanes.stopAll();
    paint();
  }

  function stopButton(): void {
    stop();
    for (const cb of stopCbs) cb();
    log.info("stop");
  }

  composer.onSubmit((text) => route(text));
  composer.onChange(paint);
  composer.onStop(stopButton);

  const unsubscribeLocale = subscribeLocale(refresh);

  return {
    el: root,
    refresh,
    speechStream({ preset, op }) {
      switch (op.op) {
        case "busy":
          castState.setBusy(preset, op.busy);
          break;
        case "name":
          castState.setName(preset, op.name);
          if (lanes.speaker() === preset) box.plate.setName(op.name);
          break;
        case "summon-input":
          // A document focus in an unfocused webview leaves the keystrokes with the pet window.
          void deps.focusWindow().then(composer.focus);
          break;
        case "input-error":
          composer.showError(
            op.message,
            op.action && {
              label: op.action.label,
              onClick: () => {
                for (const cb of errorActionCbs) cb(preset);
              },
            },
          );
          break;
        case "quote":
          lanes.accept(preset, shownQuote(op, preset, deps.cast()));
          break;
        case "begin":
        case "push":
        case "end":
        case "finish":
        case "hide":
        case "quote-signals":
        case "settle-quote":
        case "clear-quote":
          lanes.accept(preset, op);
          break;
      }
      paint();
    },
    turnDone(done) {
      sequence.turnDone(done);
      paint();
    },
    voiceSegment(text) {
      if (busy()) composer.fill(text);
      else route(text, "voice");
    },
    speechOnset() {
      if (busy()) stopButton();
    },
    stop,
    onRoute: (cb) => void routeCbs.push(cb),
    onStop: (cb) => void stopCbs.push(cb),
    onInputErrorAction: (cb) => void errorActionCbs.push(cb),
    dispose() {
      unsubscribeLocale();
      sequence.dispose();
      composer.dispose();
      box.dispose();
      chips.dispose();
      root.remove();
    },
  };
}
