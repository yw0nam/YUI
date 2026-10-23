/** Source line — one signal group as `dot · source · label`, drawn by the bubble and by History. */
import "./source-line.css";
import type { SourceLine } from "../../io/bridge/message/message-bridge";
import { t } from "../i18n";

function span(tag: "span" | "b", className: string, text = ""): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

export function renderSourceLine({ delivery, source, text }: SourceLine): HTMLElement {
  const row = span("span", `yui-source yui-source--${delivery}`);
  const dot = span("span", "yui-source__dot");
  dot.setAttribute("aria-hidden", "true");
  row.append(
    dot,
    span("span", "yui-source__class", t(`signals.delivery_${delivery}`)),
    span("b", "yui-source__src", source),
    span("span", "yui-source__text", text),
  );
  return row;
}
