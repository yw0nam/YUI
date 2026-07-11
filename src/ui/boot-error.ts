/**
 * Boot-failure notice — a static, dismissible error card shown when boot fails
 * (config or VRM load) and the transparent window would otherwise stay blank.
 * Rendering only; no judgment or recovery logic lives here.
 */

import { ConfigError } from "../config/load";
import "./boot-error.css";
import { t } from "./i18n";

export interface BootErrorContent {
  /** Localized headline. */
  title: string;
  /** Localized guidance for the failure class. */
  guidance: string;
  /** Raw failure specifics (config issues or the error's string form). */
  detail: string;
}

/** ConfigError → config guidance naming the file; anything else → VRM guidance. */
export function bootErrorContent(err: unknown): BootErrorContent {
  if (err instanceof ConfigError) {
    return {
      title: t("boot.error_title"),
      guidance: t("boot.error_config", { file: err.file }),
      detail: err.issues.join("; "),
    };
  }
  return {
    title: t("boot.error_title"),
    guidance: t("boot.error_vrm"),
    detail: String(err),
  };
}

/** Mounts the notice into `mount`; the dismiss button removes it. */
export function showBootError(mount: HTMLElement, err: unknown): HTMLElement {
  const { title, guidance, detail } = bootErrorContent(err);

  const el = document.createElement("div");
  el.className = "yui-boot-error";
  el.setAttribute("role", "alert");

  const titleEl = document.createElement("strong");
  titleEl.className = "yui-boot-error__title";
  titleEl.textContent = title;

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "yui-boot-error__dismiss";
  dismiss.setAttribute("aria-label", t("boot.error_dismiss"));
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => el.remove());

  const guidanceEl = document.createElement("p");
  guidanceEl.className = "yui-boot-error__guidance";
  guidanceEl.textContent = guidance;

  const detailEl = document.createElement("p");
  detailEl.className = "yui-boot-error__detail";
  detailEl.textContent = detail;

  el.append(titleEl, dismiss, guidanceEl, detailEl);
  mount.appendChild(el);
  return el;
}
