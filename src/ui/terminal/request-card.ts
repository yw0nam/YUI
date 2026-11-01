/**
 * The Allow card at the Terminal tab's foot while an access request waits: the oldest request's
 * preset, terminal and ask, a countdown to its denial, Show terminal when it targets another
 * terminal, how many more wait, and Deny / Allow.
 */

import { prefersReducedMotion } from "../../ambient/liveliness/tier1";
import "./request-card.css";
import type { AccessRequest, Terminal } from "../../contract";
import { createLogger } from "../../logger";
import { getLocale, t } from "../i18n";
import { avatarEl } from "../unified/avatar";
import { type PresetLookup, titleLine } from "./terminal-meta";

const log = createLogger("request-card");

/** How often the countdown redraws. */
const TICK_MS = 1_000;
/** Pairs with the card's leave in request-card.css. */
const LEAVE_MS = 140;

export function createRequestCard(deps: {
  now(): number;
  preset: PresetLookup;
  answer(requestId: string, allow: boolean): Promise<void>;
  /** Show terminal: select the request's terminal. */
  onShow(terminalId: string): void;
}): {
  el: HTMLElement;
  render(requests: AccessRequest[], terminals: Terminal[], selected: string | null): void;
  dispose(): void;
} {
  const el = document.createElement("section");
  el.className = "yui-threads-answer yui-terminal-request";
  el.setAttribute("aria-labelledby", "yui-terminal-request-ask");
  el.hidden = true;
  let shownKey: string | null = null;
  let limitEl: HTMLElement | null = null;
  let deadline = 0;
  let tick: ReturnType<typeof setInterval> | undefined;

  function countdown(): void {
    const s = Math.max(0, Math.ceil((deadline - deps.now()) / 1000));
    if (limitEl) limitEl.textContent = t("terminal.request_limit", { s });
  }

  function leave(): void {
    clearInterval(tick);
    tick = undefined;
    if (prefersReducedMotion() || typeof el.animate !== "function") {
      el.hidden = true;
      return;
    }
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LEAVE_MS }).finished.then(
      () => {
        if (shownKey === null) el.hidden = true;
      },
      () => {},
    );
  }

  function build(
    request: AccessRequest,
    terminal: Terminal | undefined,
    show: boolean,
    more: number,
  ) {
    const who = document.createElement("span");
    who.className = "yui-terminal-who";
    const name = document.createElement("strong");
    name.textContent = deps.preset(request.presetId).name;
    who.append(
      avatarEl(deps.preset(request.presetId), 20),
      name,
      terminal ? titleLine(terminal, document.createElement("span")) : "",
    );
    const ask = document.createElement("h3");
    ask.id = "yui-terminal-request-ask";
    ask.textContent = t(
      request.kind === "read" ? "terminal.request_read" : "terminal.request_write",
    );
    const left = document.createElement("div");
    left.className = "yui-terminal-request__ask";
    left.append(who, ask);
    limitEl = document.createElement("small");
    const head = document.createElement("div");
    head.className = "yui-threads-answer__head";
    head.append(left, limitEl);
    const parts: HTMLElement[] = [head];

    if (request.kind === "write") {
      const text = document.createElement("pre");
      text.textContent = request.text ?? "";
      parts.push(text);
    }

    const actions = document.createElement("div");
    actions.className = "yui-terminal-request__actions";
    if (show) {
      const showEl = document.createElement("button");
      showEl.type = "button";
      showEl.className = "yui-terminal-request__show";
      showEl.textContent = t("terminal.show");
      showEl.addEventListener("click", () => deps.onShow(request.terminalId));
      actions.append(showEl);
    }
    if (more > 0) {
      const moreEl = document.createElement("span");
      moreEl.className = "yui-terminal-request__more";
      moreEl.textContent = t("terminal.more_requests", { n: more });
      actions.append(moreEl);
    }
    const spacer = document.createElement("span");
    spacer.className = "yui-terminal-request__spacer";
    const deny = document.createElement("button");
    deny.type = "button";
    deny.textContent = t("terminal.deny");
    const allow = document.createElement("button");
    allow.type = "button";
    allow.className = "yui-threads-answer__send";
    allow.textContent = t("terminal.allow");
    for (const [button, yes] of [
      [deny, false],
      [allow, true],
    ] as const) {
      button.addEventListener("click", () => {
        deny.disabled = allow.disabled = true;
        deps.answer(request.id, yes).catch((error) => {
          log.warn("answer_failed", { error: String(error) });
          deny.disabled = allow.disabled = false;
        });
      });
    }
    actions.append(spacer, deny, allow);

    const note = document.createElement("p");
    note.className = "yui-terminal-request__note";
    note.textContent = t("terminal.allow_note");
    parts.push(actions, note);
    el.replaceChildren(...parts);
  }

  return {
    el,
    render(requests, terminals, selected) {
      // The store lists requests in the order they came, so the first is the oldest.
      const request = requests[0];
      if (!request) {
        if (shownKey !== null) leave();
        shownKey = null;
        return;
      }
      const show = request.terminalId !== selected;
      const more = requests.length - 1;
      const key = JSON.stringify([request.id, show, more, getLocale()]);
      if (key === shownKey) return;
      const entering = shownKey === null;
      shownKey = key;
      deadline = request.deadline;
      build(
        request,
        terminals.find((term) => term.id === request.terminalId),
        show,
        more,
      );
      countdown();
      tick ??= setInterval(countdown, TICK_MS);
      el.hidden = false;
      if (entering) {
        el.classList.remove("is-entering");
        void el.offsetWidth;
        el.classList.add("is-entering");
      }
    },
    dispose() {
      clearInterval(tick);
    },
  };
}
