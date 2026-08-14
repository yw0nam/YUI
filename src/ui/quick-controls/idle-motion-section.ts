/** Idle motion cluster — per-variant on/off switches for the ambient idle pool in the Character tab. */
import {
  enabledIdleVariants,
  type IdleMotionSettingsStore,
  type IdleVariantPool,
} from "../../io/idle-motion-settings";
import type { Logger } from "../../logger";
import { t } from "../i18n";

/** i18n key stem for a variant — "/motions/idle_01.vrma" → "idle_motion.idle_01". */
export function idleMotionKeyStem(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return `idle_motion.${file.replace(/\.vrma$/, "")}`;
}

interface IdleMotionListDeps {
  /** Panel root (el) — the section wrapper and switch group are queried from here. */
  root: HTMLElement;
  settings: IdleMotionSettingsStore;
  /** The read-only `idle` catalog entry; undefined until configs load. */
  getPool: () => IdleVariantPool | undefined;
  log: Logger;
}

export interface IdleMotionList {
  render(): void;
}

export function createIdleMotionList(deps: IdleMotionListDeps): IdleMotionList {
  const { settings, getPool, log } = deps;
  const sectionEl = deps.root.querySelector<HTMLDivElement>(".yui-idle-motion")!;
  const groupEl = deps.root.querySelector<HTMLDivElement>(".yui-motions")!;

  function render(): void {
    const pool = getPool();
    const catalog = pool ? (pool.variants?.length ? pool.variants : [pool.vrma_path]) : [];
    sectionEl.hidden = catalog.length === 0;
    groupEl.innerHTML = "";
    if (!pool) return;

    const enabled = enabledIdleVariants(pool, settings.get());
    for (const path of catalog) {
      const stem = idleMotionKeyStem(path);
      const label = t(`${stem}.label`);
      const isBaseline = path === pool.vrma_path;
      const sub = isBaseline
        ? `${t(`${stem}.sub`)} · ${t("idle_motion.always_on")}`
        : t(`${stem}.sub`);

      const row = document.createElement("div");
      row.className = "yui-row";
      row.innerHTML = `
        <div class="yui-row__main">
          <span class="yui-row__label"></span>
          <span class="yui-row__sub"></span>
        </div>
        <button class="yui-switch" type="button" role="switch"></button>
      `;
      row.querySelector<HTMLSpanElement>(".yui-row__label")!.textContent = label;
      row.querySelector<HTMLSpanElement>(".yui-row__sub")!.textContent = sub;

      const sw = row.querySelector<HTMLButtonElement>(".yui-switch")!;
      sw.dataset.variant = path;
      sw.setAttribute("aria-label", label);
      sw.setAttribute("aria-checked", String(enabled.includes(path)));
      // The baseline is the missing-clip fallback target, so it stays on and non-interactive.
      if (isBaseline) sw.disabled = true;
      else
        sw.addEventListener("click", () => {
          const next = sw.getAttribute("aria-checked") !== "true";
          settings.setEnabled(path, next);
          log.info("idle_motion_toggle", { variant: path, enabled: next });
        });

      groupEl.appendChild(row);
    }
  }

  return { render };
}
