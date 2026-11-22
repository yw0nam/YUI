/** The VRM import's one-shot flow: the loading row while it runs, and the inline error when it rejects. */

import { useRef, useState } from "react";
import type { Logger } from "../../../../logger";

export function useVrmImport(deps: {
  /** Pick a file, load it, add the option and select it. */
  importVrm: () => Promise<void>;
  log: Logger;
  /** Redraws the list around the flow, as any list redraw does. */
  repaint: () => void;
}) {
  const { importVrm, log, repaint } = deps;
  const [state, setState] = useState({ importing: false, importError: false });
  const busy = useRef(false);

  async function runImport(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    repaint();
    setState({ importing: true, importError: false });
    try {
      await importVrm();
    } catch (err) {
      setState((s) => ({ ...s, importError: true }));
      log.error("vrm_import_failed", { error: String(err) });
    } finally {
      busy.current = false;
      repaint();
      setState((s) => ({ ...s, importing: false }));
    }
  }

  return { ...state, runImport };
}
