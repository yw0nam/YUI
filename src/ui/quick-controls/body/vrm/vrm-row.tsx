/** One VRM radio: a bundled option is a button, an imported one a div carrying rename and remove. */

import type { MouseEvent, ReactNode } from "react";
import type { AvatarOption } from "../../../../config/validators/avatar/types";
import { t } from "../../../i18n";
import { REMOVE_SVG, RENAME_SVG } from "../../sections/user-asset-list/user-asset-list";
import { RenameInput } from "./rename-input";
import type { VrmList } from "./use-vrm-list";

function Actions({ option, list }: { option: AvatarOption; list: VrmList }) {
  const armed = list.armedId === option.id;
  const stop = (e: MouseEvent, act: () => void): void => {
    // A control does not also select the row.
    e.stopPropagation();
    act();
  };
  return (
    <>
      <button
        className="yui-vrm__rename"
        type="button"
        data-tip={t("vrm.rename")}
        aria-label={t("vrm.rename")}
        onClick={(e) => stop(e, () => list.startRename(option.id))}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with the speaker list
        dangerouslySetInnerHTML={{ __html: RENAME_SVG }}
      />
      {/* Armed or not, the button remounts, so a hint open on the old one closes. */}
      <button
        key={armed ? "armed" : "idle"}
        className={armed ? "yui-vrm__remove is-armed" : "yui-vrm__remove"}
        type="button"
        data-tip={armed ? t("vrm.remove_confirm") : t("vrm.remove")}
        aria-label={armed ? t("vrm.remove_confirm_aria", { name: option.label }) : t("vrm.remove")}
        disabled={list.removingId === option.id}
        onClick={(e) => stop(e, () => void list.remove(option.id))}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with the speaker list
        dangerouslySetInnerHTML={{
          __html: `${REMOVE_SVG}<span class="yui-vrm__remove-confirm">${t("vrm.remove_confirm")}</span>`,
        }}
      />
    </>
  );
}

export function VrmRow({ option, list }: { option: AvatarOption; list: VrmList }) {
  const user = option.source === "user";
  const selected = option.id === list.activeId;
  const renaming = user && option.id === list.renamingId;
  const error = option.id === list.errorId;
  const busy = option.id === list.swappingId || option.id === list.removingId;
  const classes = [
    "yui-vrm",
    renaming && "yui-vrm--renaming",
    user && option.id === list.armedId && "is-remove-armed",
    error && "is-error",
  ];
  // A user row holds buttons, so it is a div; a button in a button is invalid.
  const Row = user ? "div" : "button";
  let children: ReactNode;
  if (renaming) {
    children = (
      <RenameInput
        label={option.label}
        onCommit={(label) => list.commitRename(option.id, label)}
        onCancel={list.cancelRename}
      />
    );
  } else {
    children = (
      <>
        <span className="yui-vrm__tick" aria-hidden="true" />
        <span className="yui-vrm__body">
          <span className="yui-vrm__name">{option.label}</span>
        </span>
        {option.id === list.swappingId && (
          <span className="yui-vrm__hint">{t("vrm.swapping")}</span>
        )}
        {user && <Actions option={option} list={list} />}
        {selected && <span className="yui-vrm__badge">{t("vrm.in_use")}</span>}
      </>
    );
  }
  return (
    <>
      <Row
        type={user ? undefined : "button"}
        role="radio"
        className={classes.filter(Boolean).join(" ")}
        data-vrm-id={option.id}
        aria-checked={selected}
        aria-busy={busy ? "true" : undefined}
        aria-invalid={error ? "true" : undefined}
        tabIndex={option.id === list.rovedId ? 0 : -1}
        onClick={renaming ? undefined : () => void list.swapTo(option)}
      >
        {children}
      </Row>
      {error && (
        <p className="yui-vrm__error" role="status">
          {t("vrm.swap_error")}
        </p>
      )}
    </>
  );
}
