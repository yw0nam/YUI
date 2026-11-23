/** A service's reset: a text button closing its group. */

import { t } from "../../../i18n";
import type { EndpointForm, ServiceId } from "./endpoint-form";

export function ResetRow({ svc, form }: { svc: ServiceId; form: EndpointForm }) {
  return (
    <div className="yui-row yui-row--action">
      <button
        className="yui-link-btn yui-svc-reset"
        type="button"
        data-svc-reset={svc}
        onClick={() => form.reset(svc)}
      >
        {t(`svc.reset_${svc}`)}
      </button>
    </div>
  );
}
