/** thread-reaction — the main character's reaction to a Thread state change: a line, the Threads window, her seat on it, an expression. */

import type { FillerPool } from "../../config/validators/filler";
import type { EmotionId, ScreenRect, WindowRect } from "../../contract";
import type { AvatarExecutor } from "../../io/bridge/inbox/avatar-executor";
import type { ThreadsClient } from "../../io/threads/threads-client";
import type { ThreadsWindowController } from "../../io/window/openers/threads-window";

export interface ThreadReactionDeps {
  threads: Pick<ThreadsClient, "snapshot" | "subscribe">;
  /** The Thread reactions switch. */
  enabled: {
    get(): { enabled: boolean };
    subscribe(cb: (state: { enabled: boolean }) => void): () => void;
  };
  isPipelineBusy(): boolean;
  hasOutstandingSpeech(): boolean;
  /** Null until the stage created it. */
  getExecutor(): Pick<AvatarExecutor, "isBusy" | "command"> | null;
  /** The window she is seated on, or null. */
  armedSit(): { windowNumber: number } | null;
  threadsWindow: Pick<ThreadsWindowController, "isOpen" | "present">;
  /** The chip's slot, in this window's viewport. */
  slotRect(): ScreenRect | undefined;
  /** On-screen windows, front to back. */
  listWindows(): Promise<WindowRect[]>;
  /** Speaks a client-side line; "cut" when other speech took over. */
  speak(text: string): Promise<"spoken" | "cut">;
  lines(): Pick<FillerPool, "threads_open" | "threads_raise">;
  setEmotion(signal: { id: EmotionId }): void;
  easeEmotionToNeutral(): void;
  /** How long the expression holds before it eases back to neutral. */
  holdMs(): number;
}

export function createThreadReaction(_deps: ThreadReactionDeps): { dispose(): void } {
  return { dispose() {} };
}
