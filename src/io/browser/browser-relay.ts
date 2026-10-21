/**
 * The browser tool's door to the Rust relay, which runs a script or reads the guide through the
 * installed ego lite CLI. invoke is test-injectable (defaults to the real @tauri-apps/api/core invoke).
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** What one script run left behind. */
export interface RunOutcome {
  /** The CLI's stderr, where ego lite prints the script's logs. */
  output: string;
  /** The CLI's exit code; null when it ended without one. */
  exitCode: number | null;
  /** The relay killed the CLI at its backstop; the script may still run in ego lite. */
  killed: boolean;
  /** The script stopped itself at its time limit. */
  deadline: boolean;
  /** The kept screenshots as JPEG data URLs, oldest first. */
  images: string[];
  /** How many earlier screenshots were dropped past the cap. */
  dropped: number;
  /** File names of the screenshots that did not decode. */
  unreadable: string[];
}

export interface BrowserRelay {
  /** Runs code in the named task space. Rejects when the CLI cannot start. */
  run(space: string, code: string): Promise<RunOutcome>;
  /** The installed ego lite's own guide text. */
  guide(): Promise<string>;
}

export function createBrowserRelay(invoke: InvokeFn = tauriInvoke): BrowserRelay {
  return {
    run: (space, code) => invoke<RunOutcome>("browser_run", { space, code }),
    guide: () => invoke<string>("browser_guide"),
  };
}
