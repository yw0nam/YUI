/** A key page link: Tauri's opener opens target=_blank; WebKit's plain Tab skips links without a tabindex. */

import { t } from "../../../i18n";

export function KeyLink({
  url,
  labelKey,
  className,
  hidden,
}: {
  url: string;
  labelKey: string;
  className: string;
  hidden?: boolean;
}) {
  return (
    <a
      className={`yui-chat-type__link ${className}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={0}
      hidden={hidden}
    >
      {t(labelKey)}
    </a>
  );
}
