/**
 * Reusable cue-list section component.
 * Used for both time-of-day greetings (trigger: "time") and proactive reactions (trigger: "minutes").
 */

import "./cue-list.css";
import { t } from "./i18n";

// ── Store shape interfaces (minimal common form fitting both schedule and proactive) ──

interface CueBase {
  id: string;
  label: string;
  context: string;
  enabled: boolean;
}

interface SettingsBase<C extends CueBase> {
  enabled: boolean;
  entries: C[];
}

interface CueStore<C extends CueBase, S extends SettingsBase<C>> {
  get(): S;
  setEnabled(enabled: boolean): void;
  addCue(): C;
  updateCue(id: string, patch: Partial<Omit<C, "id">>): void;
  removeCue(id: string): void;
  subscribe(cb: (s: S) => void): () => void;
}

// ── Trigger description ──

type TriggerKind = { kind: "time"; field: string } | { kind: "minutes"; field: string };

interface CueListOptions<C extends CueBase, S extends SettingsBase<C>> {
  mount: HTMLElement;
  store: CueStore<C, S>;
  title: string;
  sub: string;
  /** "clock" = clock SVG, "sparkle" = sparkle SVG */
  icon: "clock" | "sparkle";
  trigger: TriggerKind;
  addLabel: string;
}

export interface CueListInstance {
  destroy(): void;
}

const CLOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5v4.8l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPARKLE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5l1.6 3.9 3.9 1.6-3.9 1.6L12 14.5l-1.6-3.9L6.5 9l3.9-1.6L12 3.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M18.5 15l.7 1.7 1.8.7-1.8.7-.7 1.7-.7-1.7-1.8-.7 1.8-.7.7-1.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const DELETE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const CHEVRON_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function createCueList<C extends CueBase, S extends SettingsBase<C>>(
  opts: CueListOptions<C, S>,
): CueListInstance {
  const { mount, store, title, sub, icon, trigger, addLabel } = opts;

  const iconSvg = icon === "clock" ? CLOCK_SVG : SPARKLE_SVG;

  // ── Section root ──
  const sectionEl = document.createElement("div");
  sectionEl.className = "yui-section";
  sectionEl.setAttribute("data-testid", "cue-section");

  // ── Header row ──
  const headerRow = document.createElement("div");
  headerRow.className = "yui-row";

  const mainEl = document.createElement("div");
  mainEl.className = "yui-row__main";

  const labelEl = document.createElement("span");
  labelEl.className = "yui-row__label";
  labelEl.setAttribute("data-testid", "cue-list-title");
  labelEl.innerHTML = `${iconSvg}${title}`;

  const subEl = document.createElement("span");
  subEl.className = "yui-row__sub";
  subEl.setAttribute("data-testid", "cue-list-sub");
  subEl.textContent = sub;

  mainEl.appendChild(labelEl);
  mainEl.appendChild(subEl);

  const masterSwitch = document.createElement("button");
  masterSwitch.type = "button";
  masterSwitch.className = "yui-switch";
  masterSwitch.setAttribute("role", "switch");
  masterSwitch.setAttribute("data-testid", "cue-list-master-switch");
  masterSwitch.setAttribute("aria-label", title);

  headerRow.appendChild(mainEl);
  headerRow.appendChild(masterSwitch);
  sectionEl.appendChild(headerRow);

  // ── Cue list ──
  const listEl = document.createElement("div");
  listEl.className = "yui-cue-list";
  sectionEl.appendChild(listEl);

  // ── Add button ──
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "yui-cue-add";
  addBtn.setAttribute("data-testid", "cue-add");
  addBtn.innerHTML = `${PLUS_SVG}${addLabel}`;
  sectionEl.appendChild(addBtn);

  mount.appendChild(sectionEl);

  // ── State reflection ──

  // Cue ids of expanded editors — survive re-renders so they re-expand.
  const expandedIds = new Set<string>();

  function reflectMaster(enabled: boolean): void {
    masterSwitch.setAttribute("aria-checked", String(enabled));
    sectionEl.classList.toggle("yui-section--off", !enabled);
  }

  function buildTriggerInput(cue: C): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "yui-cue__trigger";

    if (trigger.kind === "time") {
      const input = document.createElement("input");
      input.type = "time";
      input.className = "yui-time-input";
      input.setAttribute("aria-label", t("cue.time_aria"));
      input.setAttribute("data-testid", "cue-trigger-input");
      const value = (cue as unknown as Record<string, unknown>)[trigger.field];
      input.value = typeof value === "string" ? value : "";
      input.addEventListener("change", () => {
        store.updateCue(cue.id, { [trigger.field]: input.value } as Partial<Omit<C, "id">>);
      });
      wrapper.appendChild(input);
    } else {
      const label = document.createElement("span");
      label.className = "yui-cue__minutes-label";
      label.textContent = t("cue.minutes_word");

      const input = document.createElement("input");
      input.type = "number";
      input.className = "yui-num-input";
      input.min = "1";
      input.max = "999";
      input.setAttribute("aria-label", t("cue.minutes_aria"));
      input.setAttribute("data-testid", "cue-trigger-input");
      const value = (cue as unknown as Record<string, unknown>)[trigger.field];
      input.value = typeof value === "number" ? String(value) : "";
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (!Number.isFinite(n) || n <= 0) return;
        store.updateCue(cue.id, { [trigger.field]: n } as Partial<Omit<C, "id">>);
      });

      const suffix = document.createElement("span");
      suffix.className = "yui-cue__suffix";
      suffix.setAttribute("data-testid", "cue-minutes-suffix");
      suffix.textContent = t("cue.minutes_suffix");

      wrapper.appendChild(label);
      wrapper.appendChild(input);
      wrapper.appendChild(suffix);
    }

    return wrapper;
  }

  function buildEditorTrigger(cue: C): HTMLElement {
    const row = document.createElement("div");
    row.className = "yui-cue__ed-row";

    const edLabel = document.createElement("span");
    edLabel.className = "yui-cue__ed-label";

    if (trigger.kind === "time") {
      edLabel.textContent = t("cue.time_aria");
      const input = document.createElement("input");
      input.type = "time";
      input.className = "yui-time-input";
      input.setAttribute("aria-label", t("cue.greeting_time_aria"));
      const value = (cue as unknown as Record<string, unknown>)[trigger.field];
      input.value = typeof value === "string" ? value : "";
      input.addEventListener("change", () => {
        store.updateCue(cue.id, { [trigger.field]: input.value } as Partial<Omit<C, "id">>);
      });
      row.appendChild(edLabel);
      row.appendChild(input);
    } else {
      edLabel.textContent = t("cue.minutes_word");
      const input = document.createElement("input");
      input.type = "number";
      input.className = "yui-num-input";
      input.min = "1";
      input.max = "999";
      input.setAttribute("aria-label", t("cue.minutes_aria"));
      const value = (cue as unknown as Record<string, unknown>)[trigger.field];
      input.value = typeof value === "number" ? String(value) : "";
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (!Number.isFinite(n) || n <= 0) return;
        store.updateCue(cue.id, { [trigger.field]: n } as Partial<Omit<C, "id">>);
      });
      const suffix = document.createElement("span");
      suffix.className = "yui-cue__suffix";
      suffix.textContent = t("cue.minutes_suffix");
      row.appendChild(edLabel);
      row.appendChild(input);
      row.appendChild(suffix);
    }

    return row;
  }

  function buildCueRow(cue: C): HTMLElement {
    const cueEl = document.createElement("div");
    cueEl.className = "yui-cue";
    cueEl.setAttribute("data-testid", "cue-row");
    cueEl.setAttribute("data-cue-id", cue.id);
    if (!cue.enabled) cueEl.classList.add("yui-cue--off");
    if (expandedIds.has(cue.id)) cueEl.classList.add("yui-cue--expanded");

    // ── Collapsed row ──
    const collapsed = document.createElement("div");
    collapsed.className = "yui-cue__collapsed";

    // Cue switch
    const cueSwitch = document.createElement("button");
    cueSwitch.type = "button";
    cueSwitch.className = "yui-switch yui-switch--sm";
    cueSwitch.setAttribute("role", "switch");
    cueSwitch.setAttribute("aria-checked", String(cue.enabled));
    cueSwitch.setAttribute(
      "aria-label",
      t("cue.toggle_aria", { name: cue.label || t("cue.toggle_fallback") }),
    );
    cueSwitch.setAttribute("data-testid", "cue-switch");
    cueSwitch.addEventListener("click", () => {
      store.updateCue(cue.id, {
        enabled: !store.get().entries.find((c) => c.id === cue.id)?.enabled,
      } as Partial<Omit<C, "id">>);
    });

    // Label (name)
    const nameEl = document.createElement("span");
    nameEl.className = "yui-cue__name";
    nameEl.textContent = cue.label;

    // Trigger control
    const triggerEl = buildTriggerInput(cue);

    // Context preview
    const ctxPreview = document.createElement("span");
    ctxPreview.className = "yui-cue__ctx-preview";
    ctxPreview.setAttribute("data-testid", "cue-ctx-preview");
    ctxPreview.textContent = cue.context;

    // Delete button — opens a confirm row instead of deleting immediately (same 2-step pattern as session reset).
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "yui-cue__delete";
    deleteBtn.setAttribute("aria-label", t("cue.delete"));
    deleteBtn.setAttribute("data-testid", "cue-delete");
    deleteBtn.innerHTML = DELETE_SVG;

    // Delete confirm row
    const confirmEl = document.createElement("div");
    confirmEl.className = "yui-confirm";
    confirmEl.hidden = true;
    const confirmQ = document.createElement("span");
    confirmQ.className = "yui-confirm__q";
    confirmQ.textContent = t("cue.confirm_q");
    const confirmGo = document.createElement("button");
    confirmGo.type = "button";
    confirmGo.className = "yui-pill yui-pill--go";
    confirmGo.setAttribute("data-testid", "cue-delete-confirm");
    confirmGo.textContent = t("cue.confirm_go");
    const confirmCancel = document.createElement("button");
    confirmCancel.type = "button";
    confirmCancel.className = "yui-pill";
    confirmCancel.setAttribute("data-testid", "cue-delete-cancel");
    confirmCancel.textContent = t("cue.confirm_cancel");
    confirmEl.append(confirmQ, confirmGo, confirmCancel);

    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmEl.hidden = false;
      deleteBtn.hidden = true;
    });
    confirmGo.addEventListener("click", () => {
      expandedIds.delete(cue.id);
      store.removeCue(cue.id);
    });
    confirmCancel.addEventListener("click", () => {
      confirmEl.hidden = true;
      deleteBtn.hidden = false;
    });

    // Wrap name + preview in the aria-expanded toggle button. Nested controls (switch, delete, inputs)
    // stay as siblings outside the button to keep valid HTML.
    const labelBtn = document.createElement("button");
    labelBtn.type = "button";
    labelBtn.className = "yui-cue__label";
    labelBtn.setAttribute("data-testid", "cue-toggle");
    labelBtn.setAttribute("aria-expanded", String(expandedIds.has(cue.id)));
    const chevron = document.createElement("span");
    chevron.className = "yui-cue__chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.innerHTML = CHEVRON_SVG;
    labelBtn.appendChild(chevron);
    labelBtn.appendChild(nameEl);
    labelBtn.appendChild(ctxPreview);
    labelBtn.addEventListener("click", () => {
      const expanded = cueEl.classList.toggle("yui-cue--expanded");
      labelBtn.setAttribute("aria-expanded", String(expanded));
      if (expanded) expandedIds.add(cue.id);
      else expandedIds.delete(cue.id);
    });

    collapsed.appendChild(cueSwitch);
    collapsed.appendChild(labelBtn);
    collapsed.appendChild(triggerEl);
    collapsed.appendChild(deleteBtn);

    // ── Expanded editor ──
    const editor = document.createElement("div");
    editor.className = "yui-cue__editor";

    // Name edit row
    const nameEdRow = document.createElement("div");
    nameEdRow.className = "yui-cue__ed-row";
    const nameEdLabel = document.createElement("span");
    nameEdLabel.className = "yui-cue__ed-label";
    nameEdLabel.textContent = t("cue.name_label");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "yui-cue__name-input";
    nameInput.setAttribute("aria-label", t("cue.name_aria"));
    nameInput.value = cue.label;
    const prevLabel = { value: cue.label };
    nameInput.addEventListener("change", () => {
      const v = nameInput.value.trim();
      if (!v) {
        nameInput.value = prevLabel.value;
        return;
      }
      prevLabel.value = v;
      store.updateCue(cue.id, { label: v } as Partial<Omit<C, "id">>);
    });
    nameEdRow.appendChild(nameEdLabel);
    nameEdRow.appendChild(nameInput);

    // Trigger edit row
    const triggerEdRow = buildEditorTrigger(cue);

    // Context textarea
    const ctxWrap = document.createElement("div");
    ctxWrap.className = "yui-cue__ctx-wrap";

    const ctxLabel = document.createElement("span");
    ctxLabel.className = "yui-cue__ctx-label";
    ctxLabel.textContent = t("cue.ctx_label");

    const ctxTextarea = document.createElement("textarea");
    ctxTextarea.className = "yui-cue__ctx-textarea";
    ctxTextarea.rows = 3;
    ctxTextarea.setAttribute("aria-label", t("cue.ctx_aria"));
    ctxTextarea.placeholder = t("cue.ctx_placeholder");
    ctxTextarea.value = cue.context;
    ctxTextarea.addEventListener("change", () => {
      store.updateCue(cue.id, { context: ctxTextarea.value } as Partial<Omit<C, "id">>);
    });

    ctxWrap.appendChild(ctxLabel);
    ctxWrap.appendChild(ctxTextarea);

    editor.appendChild(nameEdRow);
    editor.appendChild(triggerEdRow);
    editor.appendChild(ctxWrap);

    cueEl.appendChild(collapsed);
    cueEl.appendChild(confirmEl);
    cueEl.appendChild(editor);

    return cueEl;
  }

  const FOCUSABLE_SEL = "button, input, textarea";

  function renderRows(entries: C[]): void {
    // Full rebuild preserves focus/input value — store position, rebuild, restore.
    const active = document.activeElement;
    let focusCueId: string | null = null;
    let focusIdx = -1;
    let focusValue: string | null = null;
    let selStart: number | null = null;
    let selEnd: number | null = null;
    if (active instanceof HTMLElement && listEl.contains(active)) {
      const row = active.closest<HTMLElement>("[data-cue-id]");
      if (row) {
        focusCueId = row.getAttribute("data-cue-id");
        focusIdx = Array.from(row.querySelectorAll(FOCUSABLE_SEL)).indexOf(active);
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          focusValue = active.value;
          try {
            selStart = active.selectionStart;
            selEnd = active.selectionEnd;
          } catch {
            // time/number inputs have no selection API
          }
        }
      }
    }

    listEl.innerHTML = "";
    for (const cue of entries) {
      listEl.appendChild(buildCueRow(cue));
    }

    if (focusCueId === null || focusIdx < 0) return;
    const row = Array.from(listEl.querySelectorAll<HTMLElement>("[data-cue-id]")).find(
      (r) => r.getAttribute("data-cue-id") === focusCueId,
    );
    const target = row?.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)[focusIdx];
    if (!target) return;
    if (
      focusValue !== null &&
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    ) {
      target.value = focusValue;
      if (selStart !== null && selEnd !== null) {
        try {
          target.setSelectionRange(selStart, selEnd);
        } catch {
          // time/number inputs have no selection API
        }
      }
    }
    target.focus();
  }

  // ── Initial render ──
  const initial = store.get();
  reflectMaster(initial.enabled);
  renderRows(initial.entries);

  // ── Event wiring ──

  function handleMasterClick(): void {
    store.setEnabled(!store.get().enabled);
  }

  masterSwitch.addEventListener("click", handleMasterClick);

  addBtn.addEventListener("click", () => {
    store.addCue();
  });

  // ── Subscriptions ──
  const unsubscribe = store.subscribe((s) => {
    reflectMaster(s.enabled);
    renderRows(s.entries);
  });

  // ── destroy ──
  function destroy(): void {
    unsubscribe();
    masterSwitch.removeEventListener("click", handleMasterClick);
    sectionEl.remove();
  }

  return { destroy };
}
