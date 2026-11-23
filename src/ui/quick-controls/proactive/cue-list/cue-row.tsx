/** One cue row: the collapsed line (toggle, trigger, switch, ×), the delete confirm, and the editor. */

import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Cue, createCueListSettings } from "../../../../settings/cues/cue-list-settings";
import { Switch } from "../../../controls/switch";
import { t } from "../../../i18n";
import { CROSS_SVG } from "../../constants";
import { setValue } from "../../persona/set-value";

export type CueTrigger = { kind: "time"; field: "time" } | { kind: "minutes"; field: "idle_min" };

export type CueStore<C extends Cue> = Pick<
  ReturnType<typeof createCueListSettings<C>>,
  "addCue" | "updateCue" | "removeCue"
>;

export function CueRow<C extends Cue>({
  cue,
  store,
  trigger,
}: {
  cue: C;
  store: CueStore<C>;
  trigger: CueTrigger;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const del = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const minutes = trigger.kind === "minutes";

  // Fields are uncontrolled: each render writes the entry onto every field the user is not typing in.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const at = String((cue as unknown as Record<string, unknown>)[trigger.field] ?? "");
    for (const f of el.querySelectorAll<HTMLInputElement>(".yui-time-input, .yui-num-input")) {
      setValue(f, at);
    }
    setValue(el.querySelector<HTMLInputElement>(".yui-cue__name-input"), cue.label);
    setValue(el.querySelector<HTMLTextAreaElement>(".yui-cue__ctx-textarea"), cue.context);
  });

  const field = (timeAria: string, testId?: string) =>
    minutes ? (
      <input
        type="number"
        className="yui-num-input"
        min={1}
        max={999}
        aria-label={t("cue.minutes_aria")}
        data-testid={testId}
      />
    ) : (
      <input type="time" className="yui-time-input" aria-label={timeAria} data-testid={testId} />
    );

  let className = "yui-cue";
  if (!cue.enabled) className += " yui-cue--off";
  if (expanded) className += " yui-cue--expanded";

  return (
    <div className={className} data-testid="cue-row" data-cue-id={cue.id} ref={row}>
      <div className="yui-cue__collapsed">
        <button
          type="button"
          className="yui-cue__label"
          data-testid="cue-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="yui-cue__chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="yui-cue__name">{cue.label}</span>
          <span className="yui-cue__ctx-preview" data-testid="cue-ctx-preview">
            {cue.context}
          </span>
        </button>
        <div className="yui-cue__trigger">
          {minutes && <span className="yui-cue__minutes-label">{t("cue.minutes_word")}</span>}
          {field(t("cue.time_aria"), "cue-trigger-input")}
          {minutes && (
            <span className="yui-cue__suffix" data-testid="cue-minutes-suffix">
              {t("cue.minutes_suffix")}
            </span>
          )}
        </div>
        <Switch
          checked={cue.enabled}
          label={t("cue.toggle_aria", { name: cue.label || t("cue.toggle_fallback") })}
          onCheckedChange={(enabled) =>
            store.updateCue(cue.id, { enabled } as Partial<Omit<C, "id">>)
          }
        />
        <button
          ref={del}
          type="button"
          className="yui-cue__delete"
          aria-label={t("cue.delete")}
          data-testid="cue-delete"
          hidden={confirming}
          onClick={() => {
            flushSync(() => setConfirming(true));
            cancel.current?.focus();
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with other surfaces
          dangerouslySetInnerHTML={{ __html: CROSS_SVG }}
        />
      </div>
      <div className="yui-confirm" hidden={!confirming}>
        <span className="yui-confirm__q">{t("cue.confirm_q")}</span>
        <button
          type="button"
          className="yui-pill yui-pill--go"
          data-testid="cue-delete-confirm"
          onClick={() => store.removeCue(cue.id)}
        >
          {t("cue.confirm_go")}
        </button>
        <button
          ref={cancel}
          type="button"
          className="yui-pill"
          data-testid="cue-delete-cancel"
          onClick={() => {
            flushSync(() => setConfirming(false));
            del.current?.focus();
          }}
        >
          {t("cue.confirm_cancel")}
        </button>
      </div>
      <div className="yui-cue__editor">
        <div className="yui-cue__ed-row">
          <span className="yui-cue__ed-label">{t("cue.name_label")}</span>
          <input type="text" className="yui-cue__name-input" aria-label={t("cue.name_aria")} />
        </div>
        <div className="yui-cue__ed-row">
          <span className="yui-cue__ed-label">
            {t(minutes ? "cue.minutes_word" : "cue.time_aria")}
          </span>
          {field(t("cue.greeting_time_aria"))}
          {minutes && <span className="yui-cue__suffix">{t("cue.minutes_suffix")}</span>}
        </div>
        <div className="yui-cue__ctx-wrap">
          <span className="yui-cue__ctx-label">{t("cue.ctx_label")}</span>
          <textarea
            className="yui-cue__ctx-textarea"
            rows={3}
            aria-label={t("cue.ctx_aria")}
            placeholder={t("cue.ctx_placeholder")}
          />
        </div>
      </div>
    </div>
  );
}
