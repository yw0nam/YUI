/** Workflows in the External signals fold: the saved rows, the fire flash, the add form and the inline delete confirm. */

import { Fragment, useEffect, useRef, useState } from "react";
import type { Logger } from "../../../../logger";
import {
  type createWorkflowSettings,
  isValidWorkflowUrl,
  type WorkflowEntry,
} from "../../../../settings/backend/workflow-settings";
import { t } from "../../../i18n";
import { useSnapshot } from "../../../use-snapshot/use-snapshot";
import "./workflow-list.css";

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
  </svg>
);
const CheckGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M5 13l4 4L19 7"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const CrossGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const PlusGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

type Flash = "ok" | "err";

export function WorkflowList({
  store,
  log,
  fetchFn,
}: {
  store: ReturnType<typeof createWorkflowSettings>;
  log: Logger;
  fetchFn?: typeof fetch;
}) {
  const { entries } = useSnapshot(store.get, store.subscribe);
  const [flash, setFlash] = useState<Record<string, Flash>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const labelRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const wasOpen = useRef(false);
  const wasConfirming = useRef<string | null>(null);

  // The form hands focus to its first field when it opens, and back to the add row when it closes.
  useEffect(() => {
    if (formOpen) labelRef.current?.focus();
    else if (wasOpen.current) addRef.current?.focus();
    wasOpen.current = formOpen;
  }, [formOpen]);

  // The confirm hands focus to Cancel; Cancel hands it back to the row's ×.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) deleteRefs.current.get(wasConfirming.current)?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const flashRow = (id: string, state: Flash): void => {
    const pending = timers.current.get(id);
    if (pending !== undefined) clearTimeout(pending);
    setFlash((current) => ({ ...current, [id]: state }));
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    timers.current.set(
      id,
      setTimeout(
        () => {
          timers.current.delete(id);
          setFlash((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
        },
        reduced ? 300 : 1500,
      ),
    );
  };

  const fire = (entry: WorkflowEntry): void => {
    // n8n webhooks do not return CORS headers, so dispatch with no-cors.
    (fetchFn ?? globalThis.fetch.bind(globalThis))(entry.url, {
      method: "POST",
      mode: "no-cors",
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    })
      .then(() => flashRow(entry.id, "ok"))
      .catch((err) => {
        log.debug("workflow_fire_failed", { id: entry.id, error: String(err) });
        flashRow(entry.id, "err");
      });
  };

  const closeForm = (): void => {
    setFormOpen(false);
    setLabel("");
    setUrl("");
  };

  const add = (): void => {
    if (store.addWorkflow({ label, url })) closeForm();
  };

  const valid = label.trim() !== "" && isValidWorkflowUrl(url);
  const invalidUrl = url.trim() !== "" && !isValidWorkflowUrl(url);

  return (
    <>
      <div className="yui-row">
        <div className="yui-row__main">
          <span className="yui-row__label">{t("workflows.title")}</span>
          <span className="yui-row__sub">{t("workflows.sub")}</span>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="yui-wf-empty">{t("workflows.empty")}</p>
      ) : (
        entries.map((entry) => (
          <Fragment key={entry.id}>
            <div className={flash[entry.id] ? `yui-wf yui-wf--fired-${flash[entry.id]}` : "yui-wf"}>
              <span className="yui-wf__name">{entry.label}</span>
              <button
                type="button"
                className="yui-wf__fire"
                aria-label={t("workflows.fire_aria", { name: entry.label })}
                onClick={() => fire(entry)}
              >
                {flash[entry.id] === "ok" ? (
                  <CheckGlyph />
                ) : flash[entry.id] === "err" ? (
                  <CrossGlyph />
                ) : (
                  <PlayGlyph />
                )}
              </button>
              <button
                type="button"
                className="yui-wf__delete"
                hidden={confirming === entry.id}
                aria-label={t("workflows.delete_aria", { name: entry.label })}
                ref={(button) => {
                  if (button) deleteRefs.current.set(entry.id, button);
                  else deleteRefs.current.delete(entry.id);
                }}
                onClick={() => setConfirming(entry.id)}
              >
                <CrossGlyph />
              </button>
            </div>
            {confirming === entry.id ? (
              <div className="yui-confirm">
                <span className="yui-confirm__q">{t("cue.confirm_q")}</span>
                <button
                  type="button"
                  className="yui-pill yui-pill--go"
                  onClick={() => {
                    setConfirming(null);
                    store.removeWorkflow(entry.id);
                  }}
                >
                  {t("cue.confirm_go")}
                </button>
                <button
                  type="button"
                  className="yui-pill"
                  ref={cancelRef}
                  onClick={() => setConfirming(null)}
                >
                  {t("cue.confirm_cancel")}
                </button>
              </div>
            ) : null}
          </Fragment>
        ))
      )}
      {formOpen ? (
        <div className="yui-wf-form">
          <div className="yui-row yui-input-row">
            <div className="yui-row__main">
              <label className="yui-input-row__label" htmlFor="yui-wf-label">
                {t("workflows.label_label")}
              </label>
            </div>
            <div className="yui-input-wrap">
              <input
                ref={labelRef}
                className="yui-ep-input"
                id="yui-wf-label"
                type="text"
                placeholder={t("workflows.label_ph")}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </div>
          <div
            className={invalidUrl ? "yui-row yui-input-row is-invalid" : "yui-row yui-input-row"}
          >
            <div className="yui-row__main">
              <label className="yui-input-row__label" htmlFor="yui-wf-url">
                {t("workflows.url_label")}
              </label>
            </div>
            <div className="yui-input-wrap">
              <input
                className="yui-ep-input"
                id="yui-wf-url"
                type="text"
                inputMode="url"
                placeholder={t("workflows.url_ph")}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
            <p className="yui-input-row__error">{t("workflows.url_error")}</p>
          </div>
          <div className="yui-row yui-row--action">
            <button
              type="button"
              className="yui-add-btn yui-wf-add-btn"
              disabled={!valid}
              onClick={add}
            >
              <PlusGlyph />
              {t("workflows.add")}
            </button>
            <button type="button" className="yui-link-btn" onClick={closeForm}>
              {t("cue.confirm_cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="yui-row yui-row--action">
          <button
            type="button"
            className="yui-add-btn yui-wf-add-btn"
            ref={addRef}
            onClick={() => setFormOpen(true)}
          >
            <PlusGlyph />
            {t("workflows.add_row")}
          </button>
        </div>
      )}
    </>
  );
}
