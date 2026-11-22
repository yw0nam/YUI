/** The pet window's control surface: the popped-out surfaces' settings asks and the cue locale sync. */

import type { RemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { SettingsPage } from "../../settings/panels/settings-pages";
import type { SettingsStores } from "../../settings/settings-stores";
import { wireCueLocaleSync } from "../settings/wire-cue-locale-sync";

export function wirePetControls(deps: {
  stores: SettingsStores;
  remoteSurfaces: Pick<RemoteSurfaces, "onOpenSettings"> | null;
  openSettings: (page?: SettingsPage) => void;
  register: (teardown: () => void) => void;
}): void {
  const { openSettings, register } = deps;
  // A popped-out surface has no settings panel of its own; it asks this window to open the settings window on Connection.
  deps.remoteSurfaces?.onOpenSettings(() => openSettings("conn"));
  register(wireCueLocaleSync(deps.stores));
}
