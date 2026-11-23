/** The eye button that shows or masks a key field; `idPrefix` names its i18n keys. */

import { t } from "../../../i18n";
import { CHATKEY_EYE_OFF_SVG, CHATKEY_EYE_SVG } from "../../constants";

export function RevealToggle({
  idPrefix,
  revealed,
  onToggle,
}: {
  idPrefix: string;
  revealed: boolean;
  onToggle(): void;
}) {
  const label = t(revealed ? `${idPrefix}.hide` : `${idPrefix}.show`);
  return (
    <button
      className="yui-iconbtn yui-chatkey__toggle"
      type="button"
      aria-pressed={revealed}
      aria-label={label}
      data-tip={label}
      onClick={onToggle}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph the key fields share
      dangerouslySetInnerHTML={{ __html: revealed ? CHATKEY_EYE_OFF_SVG : CHATKEY_EYE_SVG }}
    />
  );
}
