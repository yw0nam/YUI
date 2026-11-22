/** The Body page's VRM section: the radiogroup of models, the import row, and the VRoid Hub link. */

import type { AvatarOption } from "../../../../config/validators/avatar/types";
import type { createVrmSelection } from "../../../../io/assets/vrm-selection";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";
import { useAssetList } from "../../asset-list/use-asset-list";
import { VROID_HUB_URL } from "../../constants";
import { useVrmImport } from "./use-vrm-import";
import "./vrm-list.css";
import { VrmRow } from "./vrm-row";

export interface VrmSectionProps {
  vrmSelection: ReturnType<typeof createVrmSelection>;
  /** Load the model, then commit the selection. The list never selects on its own. */
  swapVrm: (option: AvatarOption) => Promise<void>;
  /** Pick a file, load it, add the option and select it; a reject shows the inline error. */
  importVrm: () => Promise<void>;
  /** Delete an imported VRM's file (idempotent). */
  removeUserVrm: (id: string) => Promise<void>;
  /** The store's repaints reach the list only while the tab is open. */
  isOpen: () => boolean;
  log: Logger;
  /** Re-measure hover hints after a row's label changes. */
  refreshTooltip?: () => void;
  /** Moves on each open; the list is read again and an armed remove drops. */
  revision: number;
}

export function VrmSection({
  vrmSelection,
  swapVrm,
  importVrm,
  removeUserVrm,
  isOpen,
  log,
  refreshTooltip,
  revision,
}: VrmSectionProps) {
  const list = useAssetList<AvatarOption>({
    selection: vrmSelection,
    swap: swapVrm,
    removeFile: removeUserVrm,
    removeFromStore: (id) => vrmSelection.removeUserOption(id),
    isOpen,
    revision,
    log,
    logPrefix: "vrm",
    refreshTooltip,
    classPrefix: "yui-vrm",
    datasetKey: "vrmId",
  });
  const imports = useVrmImport({ importVrm, log, repaint: list.repaint });
  const swapping = list.swappingId !== null;
  return (
    <div className="yui-sec">
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("vrm.section")}</h2>
      </div>
      <div className="yui-group">
        <div className="yui-vrm-scroll">
          <div
            ref={list.groupRef}
            className={swapping ? "yui-vrms is-swapping" : "yui-vrms"}
            role="radiogroup"
            aria-label={t("vrm.group_aria")}
            aria-busy={swapping ? "true" : undefined}
            onKeyDown={list.onKeyDown}
          >
            {list.options.map((option) => (
              <VrmRow key={option.id} option={option} list={list} />
            ))}
            {imports.importing && (
              <div className="yui-vrm__loading" role="status">
                <span className="yui-vrm__spin" aria-hidden="true" />
                <span className="yui-vrm__loading-name">{t("vrm.loading")}</span>
              </div>
            )}
          </div>
        </div>
        <div className="yui-vrm-foot">
          <button
            className="yui-vrm yui-vrm--add is-ready"
            type="button"
            onClick={() => void imports.runImport()}
          >
            <span className="yui-vrm__tick" aria-hidden="true" />
            <span className="yui-vrm__body">
              <span className="yui-vrm__name">{t("vrm.add")}</span>
            </span>
          </button>
          <p className="yui-vrm__import-error" role="status" hidden={!imports.importError}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>{t("vrm.import_error")}</span>
          </p>
        </div>
      </div>
      <p className="yui-sec__foot">
        <a
          className="yui-chat-type__link yui-vrm__hub"
          href={VROID_HUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={0}
        >
          {t("vrm.hub_link")}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 4h6v6" />
            <path d="M20 4l-9 9" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      </p>
    </div>
  );
}
