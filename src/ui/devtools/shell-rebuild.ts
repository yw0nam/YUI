import type { Logger } from "../../logger";
import type { createDevtoolsShell } from "./shell";

type Shell = ReturnType<typeof createDevtoolsShell>;

/** Focused element captured before a shell rebuild, keyed by what it takes to restore it. */
type FocusCapture =
  | { kind: "input"; id: string; value: string }
  | { kind: "select"; id: string; value: string }
  | { kind: "nav"; section: string };

/** The rebuild replaces every node, so a focused element survives only by id/section. */
function captureFocus(mount: HTMLElement): FocusCapture | null {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !mount.contains(focused)) return null;
  if (focused instanceof HTMLInputElement)
    return { kind: "input", id: focused.id, value: focused.value };
  if (focused instanceof HTMLSelectElement)
    return { kind: "select", id: focused.id, value: focused.value };
  if (focused instanceof HTMLButtonElement && focused.dataset.section) {
    return { kind: "nav", section: focused.dataset.section };
  }
  return null;
}

function restoreFocus(mount: HTMLElement, capture: FocusCapture): void {
  switch (capture.kind) {
    case "nav": {
      mount
        .querySelector<HTMLButtonElement>(`[data-section="${CSS.escape(capture.section)}"]`)
        ?.focus();
      return;
    }
    case "input": {
      const restored = document.getElementById(capture.id);
      if (!(restored instanceof HTMLInputElement)) return;
      restored.value = capture.value;
      restored.focus();
      // A scripted value carries no dirty flag, so blur would fire no change and drop the edit.
      restored.dispatchEvent(new Event("change"));
      return;
    }
    case "select": {
      const restored = document.getElementById(capture.id);
      if (!(restored instanceof HTMLSelectElement)) return;
      restored.value = capture.value;
      restored.focus();
      return;
    }
    default: {
      const exhaustive: never = capture;
      throw new Error(`unhandled focus capture kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface LocaleRebuilderInput {
  mount: HTMLElement;
  build: () => Shell;
  log: Pick<Logger, "error">;
}

/** Builds the shell once, then rebuilds it on each `rebuild()` call, one at a time, keeping focus and section. */
export function createLocaleRebuilder({ mount, build, log }: LocaleRebuilderInput): {
  rebuild: () => void;
  dispose: () => void;
} {
  let shell = build();
  let localeRebuild = Promise.resolve();
  return {
    rebuild: () => {
      localeRebuild = localeRebuild
        .then(async () => {
          const focus = captureFocus(mount);
          const section = shell.active;
          shell.dispose();
          shell = build();
          // Await so a focused motion-panel select exists before restore looks it up.
          await shell.activate(section);
          if (focus) restoreFocus(mount, focus);
        })
        .catch((error) => log.error("locale_rebuild_failed", { error: String(error) }));
    },
    dispose: () => shell.dispose(),
  };
}
