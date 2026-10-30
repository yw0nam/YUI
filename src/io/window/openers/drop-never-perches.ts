/** The windows whose drag never perches the character: their drops settle in their own windows. */

import { THREADS_WINDOW_LABEL } from "./threads-window";

/** True for the quick card's and the Threads window's labels. */
export function dropNeverPerches(label: string): boolean {
  return label === THREADS_WINDOW_LABEL || label.startsWith("quick-card");
}
