import "./workflows-section.css";

import {
  type createWorkflowSettings,
  isValidWorkflowUrl,
  type WorkflowEntry,
} from "../../io/workflow-settings";
import type { Logger } from "../../logger";
import { t } from "../i18n";

const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor"/></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>`;
const DELETE_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

interface WorkflowsSectionDeps {
  root: HTMLElement;
  store: ReturnType<typeof createWorkflowSettings>;
  log: Logger;
  fetchFn?: typeof fetch;
}

export interface WorkflowsSection {
  dispose(): void;
}

export function createWorkflowsSection(deps: WorkflowsSectionDeps): WorkflowsSection {
  const { root, store, log } = deps;
  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
  const listEl = root.querySelector<HTMLElement>(".yui-wf-list")!;
  const labelInput = root.querySelector<HTMLInputElement>(".yui-wf-label-input")!;
  const urlInput = root.querySelector<HTMLInputElement>(".yui-wf-url-input")!;
  const urlRow = root.querySelector<HTMLElement>('.yui-input-row[data-wf-field="url"]')!;
  const addBtn = root.querySelector<HTMLButtonElement>(".yui-wf-add-btn")!;
  const flashTimeouts = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const rowCleanups = new Map<HTMLElement, () => void>();
  let disposed = false;

  function clearFlash(rowEl: HTMLElement): void {
    const timeout = flashTimeouts.get(rowEl);
    if (timeout !== undefined) clearTimeout(timeout);
    flashTimeouts.delete(rowEl);
  }

  function flash(rowEl: HTMLElement, btnEl: HTMLButtonElement, state: "ok" | "err"): void {
    if (disposed) return;
    clearFlash(rowEl);
    rowEl.classList.remove("yui-wf--fired-ok", "yui-wf--fired-err");
    rowEl.classList.add(`yui-wf--fired-${state}`);
    btnEl.innerHTML = state === "ok" ? CHECK_SVG : CROSS_SVG;
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timeout = setTimeout(
      () => {
        rowEl.classList.remove("yui-wf--fired-ok", "yui-wf--fired-err");
        btnEl.innerHTML = PLAY_SVG;
        flashTimeouts.delete(rowEl);
      },
      reduced ? 300 : 1500,
    );
    flashTimeouts.set(rowEl, timeout);
  }

  function fireWorkflow(entry: WorkflowEntry, rowEl: HTMLElement, btnEl: HTMLButtonElement): void {
    // n8n webhooks do not return CORS headers, so dispatch with no-cors.
    fetchFn(entry.url, {
      method: "POST",
      mode: "no-cors",
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    })
      .then(() => flash(rowEl, btnEl, "ok"))
      .catch((err) => {
        log.debug("workflow_fire_failed", { id: entry.id, error: String(err) });
        flash(rowEl, btnEl, "err");
      });
  }

  function buildRow(entry: WorkflowEntry): HTMLElement {
    const rowEl = document.createElement("div");
    rowEl.className = "yui-wf";
    rowEl.dataset.wfId = entry.id;

    const nameEl = document.createElement("span");
    nameEl.className = "yui-wf__name";
    nameEl.textContent = entry.label;

    const fireBtn = document.createElement("button");
    fireBtn.type = "button";
    fireBtn.className = "yui-wf__fire";
    fireBtn.setAttribute("aria-label", t("workflows.fire_aria", { name: entry.label }));
    fireBtn.innerHTML = PLAY_SVG;
    const handleFire = (): void => fireWorkflow(entry, rowEl, fireBtn);
    fireBtn.addEventListener("click", handleFire);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "yui-wf__delete";
    deleteBtn.setAttribute("aria-label", t("workflows.delete_aria", { name: entry.label }));
    deleteBtn.innerHTML = DELETE_SVG;
    const handleDelete = (): void => store.removeWorkflow(entry.id);
    deleteBtn.addEventListener("click", handleDelete);

    rowEl.append(nameEl, fireBtn, deleteBtn);
    rowCleanups.set(rowEl, () => {
      clearFlash(rowEl);
      fireBtn.removeEventListener("click", handleFire);
      deleteBtn.removeEventListener("click", handleDelete);
    });
    return rowEl;
  }

  function render(): void {
    for (const cleanup of rowCleanups.values()) cleanup();
    rowCleanups.clear();
    listEl.innerHTML = "";
    const entries = store.get().entries;
    if (entries.length === 0) {
      const emptyEl = document.createElement("p");
      emptyEl.className = "yui-wf-empty";
      emptyEl.textContent = t("workflows.empty");
      listEl.appendChild(emptyEl);
      return;
    }
    for (const entry of entries) listEl.appendChild(buildRow(entry));
  }

  function validateForm(): void {
    const url = urlInput.value;
    addBtn.disabled = labelInput.value.trim() === "" || !isValidWorkflowUrl(url);
    urlRow.classList.toggle("is-invalid", url.trim() !== "" && !isValidWorkflowUrl(url));
  }

  function handleAdd(): void {
    const entry = store.addWorkflow({ label: labelInput.value, url: urlInput.value });
    if (!entry) return;
    labelInput.value = "";
    urlInput.value = "";
    urlRow.classList.remove("is-invalid");
    addBtn.disabled = true;
  }

  labelInput.addEventListener("input", validateForm);
  urlInput.addEventListener("input", validateForm);
  addBtn.addEventListener("click", handleAdd);
  const unsubscribe = store.subscribe(render);
  render();

  return {
    dispose() {
      disposed = true;
      unsubscribe();
      labelInput.removeEventListener("input", validateForm);
      urlInput.removeEventListener("input", validateForm);
      addBtn.removeEventListener("click", handleAdd);
      for (const cleanup of rowCleanups.values()) cleanup();
      rowCleanups.clear();
      for (const timeout of flashTimeouts.values()) clearTimeout(timeout);
      flashTimeouts.clear();
    },
  };
}
