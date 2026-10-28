/**
 * ingress-dead — subscribes to the Rust `ingress-dead` Tauri event channel.
 *
 * Carries the notice that the loopback listener gave up binding its port. Mirrors
 * `tauri-listen.ts` as a lightweight seam: degrades silently off-Tauri so the module is
 * safe in browser / test / dev environments without the runtime.
 */

import { createInbox } from "./create-inbox";

/** Subscribe to `ingress-dead` — the Rust listener gave up binding its port after retries. */
export const onIngressDead = createInbox<{ port: number }>("ingress-dead");
