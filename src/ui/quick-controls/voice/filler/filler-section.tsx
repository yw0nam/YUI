/** The Voice page's thinking-filler section: the enable switch, the language segment and the eight phrase-pool textareas. */

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { FillerLang } from "../../../../config/validators/filler";
import type { createFillerSettings } from "../../../../settings/voice/filler-settings";
import { Disclosure } from "../../../controls/disclosure";
import { Segment } from "../../../controls/segment";
import { Switch } from "../../../controls/switch";
import { t } from "../../../i18n";
import type { SwitchRow } from "../../switch-row";
import { parseToolLines, serializeToolLines } from "./filler-tool-lines";

type FillerSettingsStore = ReturnType<typeof createFillerSettings>;
type PoolField = (typeof FIELDS)[number];

// A row with no store has nothing to follow.
const subscribeNever = () => () => {};

const LANG_OPTIONS = [
  { value: "ja", label: "日本語" },
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
] as const satisfies readonly { value: FillerLang; label: string }[];

/** The eight textareas in the store's pool order: the first two sit in the group, the rest fold. */
const FIELDS = [
  { key: "first", cls: "first" },
  { key: "repeat", cls: "repeat" },
  { key: "long_wait", cls: "long-wait" },
  { key: "timeout", cls: "timeout" },
  { key: "unreachable", cls: "unreachable" },
  { key: "threads_open", cls: "threads-open" },
  { key: "threads_raise", cls: "threads-raise" },
  { key: "tool", cls: "tool" },
] as const;

// Parse textarea rows line-by-line (trim + remove empty lines).
const parseLines = (value: string): string[] =>
  value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

function Field({
  field,
  setRef,
}: {
  field: PoolField;
  setRef: (key: PoolField["key"], el: HTMLTextAreaElement | null) => void;
}) {
  return (
    <div className="yui-stack">
      <span className="yui-row__label">{t(`filler.${field.key}_label`)}</span>
      <span className="yui-row__sub">{t(`filler.${field.key}_sub`)}</span>
      <textarea
        ref={(el) => setRef(field.key, el)}
        className={`yui-textarea yui-textarea--short yui-filler-${field.cls}-textarea`}
        spellCheck={false}
        rows={3}
        aria-label={t(`filler.${field.key}_aria`)}
      />
    </div>
  );
}

export function FillerSection({
  settings,
  row,
  revision,
}: {
  settings: FillerSettingsStore;
  /** The enable switch's descriptor. */
  row: SwitchRow;
  /** Moves on each open; the textareas are written from the store again. */
  revision: number;
}) {
  const state = useSyncExternalStore(settings.subscribe, settings.current);
  const enabled = useSyncExternalStore(row.subscribe ?? subscribeNever, row.getEnabled);
  const refs = useRef<Partial<Record<PoolField["key"], HTMLTextAreaElement | null>>>({});
  const setRef = (key: PoolField["key"], el: HTMLTextAreaElement | null): void => {
    refs.current[key] = el;
  };

  // The textareas are uncontrolled, so each change of the store writes the current language's pool into them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: an open writes them again
  useLayoutEffect(() => {
    const pool = state.customPools[state.language];
    for (const { key } of FIELDS) {
      const el = refs.current[key];
      if (!el) continue;
      el.value =
        key === "tool" ? serializeToolLines(pool?.tool ?? {}) : (pool?.[key] ?? []).join("\n");
    }
  }, [state, revision]);

  // When editing any one field, write every field's current value together so none clobbers another.
  function writePool(): void {
    const value = (key: PoolField["key"]): string => refs.current[key]?.value ?? "";
    settings.setCustomPool(settings.current().language, {
      first: parseLines(value("first")),
      repeat: parseLines(value("repeat")),
      long_wait: parseLines(value("long_wait")),
      timeout: parseLines(value("timeout")),
      unreachable: parseLines(value("unreachable")),
      threads_open: parseLines(value("threads_open")),
      threads_raise: parseLines(value("threads_raise")),
      tool: parseToolLines(value("tool")),
    });
  }

  const fields = (list: readonly PoolField[]) =>
    list.map((field) => <Field key={field.key} field={field} setRef={setRef} />);
  return (
    <div
      className="yui-sec yui-filler"
      onInput={(event) => {
        // The segment's hidden radio inputs bubble input; only the pool textareas edit the pool.
        if (event.target instanceof HTMLTextAreaElement) writePool();
      }}
    >
      <div className="yui-sec__head">
        <h2 className="yui-sec__title">{t("filler.section")}</h2>
        <Switch
          className={row.selector.slice(1)}
          checked={enabled}
          label={t(row.ariaKey)}
          onCheckedChange={(next) => row.setEnabled(next)}
        />
      </div>
      {row.subKey ? <p className="yui-sec__note">{t(row.subKey)}</p> : null}
      <div className="yui-group">
        <div className="yui-row">
          <div className="yui-row__main">
            <span className="yui-row__label">{t("filler.lang_label")}</span>
            <span className="yui-row__sub">{t("filler.lang_sub")}</span>
          </div>
          <Segment
            className="yui-filler-lang-seg"
            options={LANG_OPTIONS}
            value={state.language}
            label={t("filler.lang_aria")}
            onValueChange={(language) => settings.setLanguage(language)}
          />
        </div>
        {fields(FIELDS.slice(0, 2))}
      </div>
      <p className="yui-sec__foot">{t("filler.hint")}</p>
      <Disclosure label={t("filler.more")}>
        <div className="yui-group">{fields(FIELDS.slice(2))}</div>
      </Disclosure>
    </div>
  );
}
