/**
 * The Connection page's two views: Quick start and Detailed settings. The switch above them picks
 * which one shows; both stay mounted, so settings search reads the hidden one too.
 */

import { Segment } from "../../controls/segment";
import { t } from "../../i18n";
import {
  DetailSettings,
  type DetailSettingsDeps,
  type DetailSettingsHandle,
} from "./detail/detail-settings";
import { QuickStart, type QuickStartDeps, type QuickStartHandle } from "./quick-start/quick-start";
import "./connection-page.css";

export type ConnectionView = "quick" | "detail";

interface ConnectionPageViewProps {
  view: ConnectionView;
  onView(view: ConnectionView): void;
  quick: QuickStartDeps;
  detail: DetailSettingsDeps;
  quickHandle: QuickStartHandle;
  detailHandle: DetailSettingsHandle;
}

export function ConnectionPageView({
  view,
  onView,
  quick,
  detail,
  quickHandle,
  detailHandle,
}: ConnectionPageViewProps) {
  return (
    <>
      <Segment<ConnectionView>
        className="yui-conn-views"
        label={t("start.views_aria")}
        options={[
          { value: "quick", label: t("start.view_quick") },
          { value: "detail", label: t("start.view_detail") },
        ]}
        value={view}
        onValueChange={onView}
      />
      <div
        className="yui-conn-view"
        data-view="quick"
        data-search-view=""
        hidden={view !== "quick"}
      >
        <div className="yui-tab-stack">
          <QuickStart {...quick} handle={quickHandle} />
        </div>
      </div>
      <div
        className="yui-conn-view"
        data-view="detail"
        data-search-view=""
        hidden={view !== "detail"}
      >
        <p className="yui-sec__note">{t("start.detail_note")}</p>
        <div className="yui-tab-stack">
          <DetailSettings {...detail} handle={detailHandle} />
        </div>
      </div>
    </>
  );
}
