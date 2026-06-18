/**
 * 재사용 가능한 큐 목록 섹션 컴포넌트.
 * 시간대 인사(trigger: "time") · 주도적 반응(trigger: "minutes") 양쪽에 쓰인다.
 */

import "./cue-list.css";
import { t } from "./i18n";

// ── 스토어 구조 인터페이스 (스케줄/프로액티브 양쪽에 맞는 최소 공통 형태) ──

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

// ── 트리거 설명 ──

type TriggerKind = { kind: "time"; field: string } | { kind: "minutes"; field: string };

export interface CueListOptions<C extends CueBase, S extends SettingsBase<C>> {
  mount: HTMLElement;
  store: CueStore<C, S>;
  title: string;
  sub: string;
  /** "clock" = 시계 SVG, "sparkle" = 반짝임 SVG */
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

export function createCueList<C extends CueBase, S extends SettingsBase<C>>(
  opts: CueListOptions<C, S>,
): CueListInstance {
  const { mount, store, title, sub, icon, trigger, addLabel } = opts;

  const iconSvg = icon === "clock" ? CLOCK_SVG : SPARKLE_SVG;

  // ── 섹션 루트 ──
  const sectionEl = document.createElement("div");
  sectionEl.className = "yui-section";
  sectionEl.setAttribute("data-testid", "cue-section");

  // ── 헤더 행 ──
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

  // ── 큐 목록 ──
  const listEl = document.createElement("div");
  listEl.className = "yui-cue-list";
  sectionEl.appendChild(listEl);

  // ── 추가 버튼 ──
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "yui-cue-add";
  addBtn.setAttribute("data-testid", "cue-add");
  addBtn.innerHTML = `${PLUS_SVG}${addLabel}`;
  sectionEl.appendChild(addBtn);

  mount.appendChild(sectionEl);

  // ── 상태 반영 ──

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

    // ── 접힌 행 ──
    const collapsed = document.createElement("div");
    collapsed.className = "yui-cue__collapsed";

    // 큐 스위치
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

    // 라벨(이름)
    const nameEl = document.createElement("span");
    nameEl.className = "yui-cue__name";
    nameEl.textContent = cue.label;

    // 트리거 컨트롤
    const triggerEl = buildTriggerInput(cue);

    // 컨텍스트 미리보기
    const ctxPreview = document.createElement("span");
    ctxPreview.className = "yui-cue__ctx-preview";
    ctxPreview.setAttribute("data-testid", "cue-ctx-preview");
    ctxPreview.textContent = cue.context;

    // 삭제 버튼
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "yui-cue__delete";
    deleteBtn.setAttribute("aria-label", t("cue.delete"));
    deleteBtn.setAttribute("data-testid", "cue-delete");
    deleteBtn.innerHTML = DELETE_SVG;
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      store.removeCue(cue.id);
    });

    collapsed.appendChild(cueSwitch);
    collapsed.appendChild(nameEl);
    collapsed.appendChild(triggerEl);
    collapsed.appendChild(ctxPreview);
    collapsed.appendChild(deleteBtn);

    // ── 펼침 편집창 ──
    const editor = document.createElement("div");
    editor.className = "yui-cue__editor";

    // 이름 편집 행
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

    // 트리거 편집 행
    const triggerEdRow = buildEditorTrigger(cue);

    // 컨텍스트 텍스트에어리어
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

    // 접힌 행 클릭 → 펼치기/접기 토글(삭제/스위치/입력 제외)
    collapsed.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("[data-testid='cue-switch']") ||
        target.closest("[data-testid='cue-delete']") ||
        target.closest("input")
      )
        return;
      cueEl.classList.toggle("yui-cue--expanded");
    });

    cueEl.appendChild(collapsed);
    cueEl.appendChild(editor);

    return cueEl;
  }

  function renderRows(entries: C[]): void {
    listEl.innerHTML = "";
    for (const cue of entries) {
      listEl.appendChild(buildCueRow(cue));
    }
  }

  // ── 초기 렌더 ──
  const initial = store.get();
  reflectMaster(initial.enabled);
  renderRows(initial.entries);

  // ── 이벤트 연결 ──

  function handleMasterClick(): void {
    store.setEnabled(!store.get().enabled);
  }

  masterSwitch.addEventListener("click", handleMasterClick);

  addBtn.addEventListener("click", () => {
    store.addCue();
  });

  // ── 구독 ──
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
