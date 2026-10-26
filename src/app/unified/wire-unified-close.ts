import { createLogger } from "../../logger";
import type { FlagSettingsStore } from "../../settings/persisted-store";

const log = createLogger("wire-unified-close");

/** The window closing itself (× or Cmd+W) turns the Unified chat switch off; a destroy by main's open rule asks nothing. */
export async function wireUnifiedClose(deps: {
  listenCloseRequested(onRequest: () => void): Promise<() => void>;
  switch: Pick<FlagSettingsStore, "setEnabled">;
  emitSettingsChanged(): void;
}): Promise<() => void> {
  return deps.listenCloseRequested(() => {
    deps.switch.setEnabled(false);
    log.info("unified_chat_toggle", { enabled: false, via: "close" });
    deps.emitSettingsChanged();
  });
}
