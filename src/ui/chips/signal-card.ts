/** Signal card — one signal group's source line, kind, label, time, what YUI said, and its raw items. */

import { t } from "../i18n";
import { renderSourceLine } from "../signals/source-line";
import type { SignalChipItem } from "./signal-chips-model";

const CROSS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export function renderSignalCard(
  item: SignalChipItem,
  { onDismiss, onClose }: { onDismiss: () => void; onClose: () => void },
): HTMLElement {
  const { envelope, items } = item.group;
  const card = document.createElement("div");
  card.className = "yui-sigcard";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", t("sigchip.card_aria"));
  card.innerHTML = `
    <div class="yui-sigcard__head">
      <button type="button" class="yui-sigcard__close">${CROSS_SVG}</button>
    </div>
    <dl class="yui-sigcard__rows"></dl>
    <p class="yui-sigcard__said"></p>
    <pre class="yui-sigcard__items"></pre>
    <button type="button" class="yui-sigcard__dismiss"></button>
  `;

  const close = card.querySelector<HTMLButtonElement>(".yui-sigcard__close")!;
  close.setAttribute("aria-label", t("sigchip.close"));
  close.addEventListener("click", onClose);
  card.querySelector(".yui-sigcard__head")!.prepend(
    renderSourceLine({
      delivery: item.delivery,
      source: envelope.source,
      text: envelope.label ?? envelope.event_type,
    }),
  );

  const rows: [string, string][] = [["sigchip.kind", envelope.event_type]];
  if (envelope.label) rows.push(["sigchip.label", envelope.label]);
  rows.push([
    "sigchip.received",
    new Date(item.received_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  ]);
  const dl = card.querySelector(".yui-sigcard__rows")!;
  for (const [key, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = t(key);
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }

  const said = card.querySelector<HTMLElement>(".yui-sigcard__said")!;
  said.textContent = item.said === null ? t("sigchip.silent") : `“${item.said}”`;
  card.querySelector(".yui-sigcard__items")!.textContent = JSON.stringify(items, null, 1);

  const dismiss = card.querySelector<HTMLButtonElement>(".yui-sigcard__dismiss")!;
  dismiss.textContent = t("sigchip.dismiss");
  dismiss.addEventListener("click", onDismiss);
  return card;
}
