/** Signal details — one signal group's source line, kind, label, time, what YUI said, and its raw items. */

import { t } from "../i18n";
import { CROSS_SVG } from "../quick-controls/constants";
import { renderSourceLine } from "../signals/source-line";
import type { SignalChipItem } from "./signal-chips-model";

export function renderSignalDetails(
  item: SignalChipItem,
  { onDismiss, onClose }: { onDismiss: () => void; onClose: () => void },
): HTMLElement {
  const { envelope, items } = item.group;
  const sheet = document.createElement("div");
  sheet.className = "yui-sigdetails";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", t("sigchip.details_aria"));
  sheet.innerHTML = `
    <div class="yui-sigdetails__head">
      <button type="button" class="yui-sigdetails__close">${CROSS_SVG}</button>
    </div>
    <dl class="yui-sigdetails__rows"></dl>
    <p class="yui-sigdetails__said"></p>
    <pre class="yui-sigdetails__items"></pre>
    <button type="button" class="yui-sigdetails__dismiss"></button>
  `;

  const close = sheet.querySelector<HTMLButtonElement>(".yui-sigdetails__close")!;
  close.setAttribute("aria-label", t("sigchip.close"));
  close.addEventListener("click", onClose);
  sheet.querySelector(".yui-sigdetails__head")!.prepend(
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
  const dl = sheet.querySelector(".yui-sigdetails__rows")!;
  for (const [key, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = t(key);
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }

  sheet.querySelector(".yui-sigdetails__said")!.textContent =
    item.said === null ? t("history.signal_silent") : `“${item.said}”`;
  sheet.querySelector(".yui-sigdetails__items")!.textContent = JSON.stringify(items, null, 1);

  const dismiss = sheet.querySelector<HTMLButtonElement>(".yui-sigdetails__dismiss")!;
  dismiss.textContent = t("sigchip.dismiss");
  dismiss.addEventListener("click", onDismiss);
  return sheet;
}
