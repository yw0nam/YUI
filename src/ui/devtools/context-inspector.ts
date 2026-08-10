import type { ContextHistoryEntry, createContextHistory } from "../../io/context-history";
import { t } from "../i18n";

type ContextHistoryStore = ReturnType<typeof createContextHistory>;

function timeOf(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ts);
}

export function createContextInspector(
  mount: HTMLElement,
  history: ContextHistoryStore,
): { dispose(): void } {
  mount.classList.add("devtools-inspector");
  mount.innerHTML = `
    <div class="devtools-turns" role="listbox"></div>
    <div class="devtools-context-detail"></div>
  `;
  const list = mount.querySelector<HTMLDivElement>(".devtools-turns")!;
  list.setAttribute("aria-label", t("devtools.inspector.turns_aria"));
  const detail = mount.querySelector<HTMLDivElement>(".devtools-context-detail")!;
  let selectedTs: number | null = null;

  function renderDetail(entry: ContextHistoryEntry | undefined): void {
    detail.replaceChildren();
    if (!entry) {
      const empty = document.createElement("div");
      empty.className = "devtools-empty";
      const title = document.createElement("strong");
      title.textContent = t("devtools.inspector.empty_title");
      const sub = document.createElement("span");
      sub.textContent = t("devtools.inspector.empty_sub");
      empty.append(title, sub);
      detail.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.className = "devtools-detail-header";
    header.innerHTML = `
      <time>${timeOf(entry.ts)}</time>
      <span class="devtools-kind"></span>
      <span class="devtools-event"></span>
    `;
    header.querySelector(".devtools-kind")!.textContent = entry.trigger_kind;
    header.querySelector(".devtools-event")!.textContent = entry.event_name;

    const json = document.createElement("pre");
    json.className = "devtools-json";
    json.textContent = JSON.stringify(entry.client_context, null, 2);
    detail.append(header, json);
  }

  function render(entries: ContextHistoryEntry[]): void {
    const newestFirst = [...entries].reverse();
    if (selectedTs === null || !newestFirst.some((entry) => entry.ts === selectedTs)) {
      selectedTs = newestFirst[0]?.ts ?? null;
    }
    list.replaceChildren();
    list.hidden = newestFirst.length === 0;
    for (const entry of newestFirst) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "devtools-turn";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(entry.ts === selectedTs));
      row.innerHTML = `
        <span class="devtools-turn__top">
          <time>${timeOf(entry.ts)}</time>
          <span class="devtools-kind"></span>
        </span>
        <span class="devtools-turn__summary"></span>
      `;
      row.querySelector(".devtools-kind")!.textContent = entry.trigger_kind;
      row.querySelector(".devtools-turn__summary")!.textContent = entry.event_name;
      row.addEventListener("click", () => {
        selectedTs = entry.ts;
        render(entries);
      });
      list.appendChild(row);
    }
    renderDetail(newestFirst.find((entry) => entry.ts === selectedTs));
  }

  render(history.get());
  const unsubscribe = history.subscribe(render);
  return { dispose: unsubscribe };
}
