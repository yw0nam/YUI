/** The thread pane: its head and a transcript that redraws per Thread and keeps a reader above the newest entry in place. */

import "./thread-pane.css";
import { type RefObject, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { AttachedThread, Thread, ThreadEntry } from "../../../contract";
import { isWaiting } from "../../../io/threads/threads-waiting";
import { t } from "../../i18n";
import { RefMount } from "../../ref-mount";
import { CHECK_PATHS } from "../glyphs";
import { threadSource } from "../thread-source";
import { entryMarkdown } from "./entry-markdown";
import { Glyph } from "./glyph";
import { relativeTime } from "./relative-time";
import { SourceLine, StateWord } from "./thread-meta";

function speaker(entry: ThreadEntry, source: string): string {
  if (entry.role === "user") return t("threads.role_user");
  if (entry.role === "system") return t("threads.role_system");
  return threadSource(source).name;
}

/** The height of the last `added` children of `entries`, with the gap above them. */
function addedHeight(entries: Element, added: number): number {
  const anchor = entries.children[entries.children.length - added - 1];
  return anchor
    ? entries.getBoundingClientRect().bottom - anchor.getBoundingClientRect().bottom
    : 0;
}

/** Where the last transcript left its reader, for the next one of the same Thread and open. */
interface Reader {
  id: string;
  scrollTop: number;
  lastAt: number;
}

function Transcript({
  thread,
  id,
  now,
  reader,
}: {
  thread: Thread;
  /** The Thread and the open it draws; another one starts at the newest entry. */
  id: string;
  now: number;
  reader: RefObject<Reader | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Runs once: the pane keys the transcript by what it shows, so a change draws a new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the transcript remounts for new props.
  useLayoutEffect(() => {
    const el = ref.current!;
    const was = reader.current;
    // scrollTop counts down from 0 at the bottom, so 0 stays at the newest entry, and a reader above it moves up by what is added under them.
    if (was?.id === id && was.scrollTop) {
      const added = thread.entries.filter((entry) => entry.at > was.lastAt).length;
      el.scrollTop = was.scrollTop - addedHeight(el.firstElementChild!, added);
    }
    return () => {
      reader.current = { id, scrollTop: el.scrollTop, lastAt: thread.entries.at(-1)?.at ?? 0 };
    };
  }, []);
  return (
    <div ref={ref} className="yui-threads-pane__transcript">
      <div className="yui-threads-pane__entries">
        {thread.entries.map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries only append, and a change draws a new transcript.
          <section key={i} className={`yui-threads-entry is-${entry.role}`}>
            <div className="yui-threads-entry__head">
              {speaker(entry, thread.source)}
              <time>{relativeTime(entry.at, now)}</time>
            </div>
            <RefMount
              className="yui-threads-entry__text"
              deps={[entry.text]}
              mount={(host) => {
                host.replaceChildren(...entryMarkdown(entry.text));
              }}
            />
          </section>
        ))}
      </div>
    </div>
  );
}

/** Main's attached Threads, as the Threads window last heard them. */
export interface AttachedSource {
  get(): AttachedThread[];
  subscribe(cb: () => void): () => void;
}

export function ThreadPane({
  thread,
  opened,
  now,
  onRead,
  onBack,
  attached,
  onAttach,
}: {
  thread: Thread | undefined;
  /** Counts the opens; each starts a fresh transcript. */
  opened: number;
  now: number;
  onRead(id: string): void;
  /** The narrow layout's way back to the list. */
  onBack(): void;
  attached: AttachedSource;
  /** Attach to chat, or take the Thread off again. */
  onAttach(thread: AttachedThread): void;
}) {
  const reader = useRef<Reader | null>(null);
  const attachedList = useSyncExternalStore(attached.subscribe, attached.get);
  const isAttached = thread !== undefined && attachedList.some((a) => a.id === thread.id);
  // An empty pane forgets its reader, so the next Thread starts at its newest entry.
  useLayoutEffect(() => {
    if (!thread) reader.current = null;
  });
  return (
    <article className="yui-threads-pane" aria-label={t("threads.pane_aria")}>
      {thread && (
        <>
          <header className="yui-threads-pane__head">
            <div className="yui-threads-pane__line">
              <button
                type="button"
                className="yui-threads-pane__back yui-threads-button"
                onClick={onBack}
              >
                {t("threads.back")}
              </button>
              <SourceLine source={thread.source} />
              <StateWord thread={thread} />
              {isWaiting(thread) && (
                <button
                  type="button"
                  className="yui-threads-pane__read"
                  onClick={() => onRead(thread.id)}
                >
                  <Glyph paths={CHECK_PATHS} />
                  {t("threads.mark_read")}
                </button>
              )}
              <button
                type="button"
                className={`yui-threads-pane__attach${isAttached ? " is-attached" : ""}`}
                onClick={() =>
                  onAttach({ id: thread.id, source: thread.source, title: thread.title })
                }
              >
                {t(isAttached ? "threads.attached" : "threads.attach")}
              </button>
            </div>
            <h2 tabIndex={-1}>{thread.title}</h2>
            {thread.label && <p className="yui-threads-pane__label">{thread.label}</p>}
          </header>
          <Transcript
            key={`${thread.id}\n${thread.updated_at}\n${opened}`}
            thread={thread}
            id={`${thread.id}\n${opened}`}
            now={now}
            reader={reader}
          />
        </>
      )}
    </article>
  );
}
