/** Source line — one signal group as `dot · source · label`, drawn by the bubble and by History. */
import "./source-line.css";
import type { SourceLine } from "../../io/bridge/message/message-bridge";
import type { SignalRecord } from "../../io/chat/conversation/signal-history-store";
import { t } from "../i18n";

/** A stored signal record as the line History draws for it. */
export function sourceLineOf(record: SignalRecord): SourceLine {
  return {
    delivery: record.delivery,
    source: record.source,
    text: record.label ?? record.event_type,
  };
}

function span(tag: "span" | "b", className: string, text = ""): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

export function renderSourceLine({ delivery, source, text }: SourceLine): HTMLElement {
  const row = span("span", `yui-signal-line yui-signal-line--${delivery}`);
  const dot = span("span", "yui-signal-line__dot");
  dot.setAttribute("aria-hidden", "true");
  row.append(
    dot,
    span("span", "yui-signal-line__class", t(`signals.delivery_${delivery}`)),
    span("b", "yui-signal-line__src", source),
    span("span", "yui-signal-line__text", text),
  );
  return row;
}
