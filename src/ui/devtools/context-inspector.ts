import type { ContextHistoryEntry, createContextHistory } from "../../io/context-history";

type ContextHistoryStore = ReturnType<typeof createContextHistory>;

const SIGNAL_LABELS: Record<string, string> = {
  active_app: "app",
  active_window_title: "title",
  posture: "posture",
  recent_apps: "recent apps",
  screenshot: "screenshot",
};

function timeOf(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(ts);
}

function signalLabel(signal: string): string {
  return SIGNAL_LABELS[signal] ?? signal.replaceAll("_", " ");
}

export function createContextInspector(
  mount: HTMLElement,
  history: ContextHistoryStore,
): { dispose(): void } {
  mount.classList.add("devtools-inspector");
  mount.innerHTML = `
    <div class="devtools-turns" role="listbox" aria-label="Recent turns"></div>
    <div class="devtools-context-detail"></div>
  `;
  const list = mount.querySelector<HTMLDivElement>(".devtools-turns")!;
  const detail = mount.querySelector<HTMLDivElement>(".devtools-context-detail")!;
  let selectedTs: number | null = null;

  function renderDetail(entry: ContextHistoryEntry | undefined): void {
    detail.replaceChildren();
    if (!entry) {
      const empty = document.createElement("div");
      empty.className = "devtools-empty";
      empty.innerHTML =
        "<strong>No sent context yet</strong><span>Successful turns appear here.</span>";
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

    const signals = document.createElement("div");
    signals.className = "devtools-signals";
    for (const signal of entry.included) {
      const pill = document.createElement("span");
      pill.className = "devtools-signal";
      pill.textContent = signalLabel(signal);
      signals.appendChild(pill);
    }
    for (const signal of entry.excluded) {
      const pill = document.createElement("span");
      pill.className = "devtools-signal is-off";
      pill.append(signalLabel(signal), " ");
      const tag = document.createElement("span");
      tag.className = "devtools-off-tag";
      tag.textContent = "OFF";
      pill.appendChild(tag);
      signals.appendChild(pill);
    }

    const json = document.createElement("pre");
    json.className = "devtools-json";
    json.textContent = JSON.stringify(entry.client_context, null, 2);
    detail.append(header, signals, json);
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
      row.querySelector(".devtools-turn__summary")!.textContent =
        entry.included.map(signalLabel).join(" · ") || "baseline only";
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
