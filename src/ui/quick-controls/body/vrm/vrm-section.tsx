/** The Body page's VRM section: the radiogroup of models, the import row, and the VRoid Hub link. */

import { t } from "../../../i18n";
import { VROID_HUB_URL } from "../../constants";
import "./vrm-list.css";
import { useVrmList, type VrmListDeps } from "./use-vrm-list";
import { VrmRow } from "./vrm-row";

export function VrmSection(deps: VrmListDeps) {
  const list = useVrmList(deps);
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
            {list.importing && (
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
            onClick={() => void list.runImport()}
          >
            <span className="yui-vrm__tick" aria-hidden="true" />
            <span className="yui-vrm__body">
              <span className="yui-vrm__name">{t("vrm.add")}</span>
            </span>
          </button>
          <p className="yui-vrm__import-error" role="status" hidden={!list.importError}>
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
