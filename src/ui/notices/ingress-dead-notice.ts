/**
 * wireIngressDeadNotice — one-off system notice through the speech bubble when
 * the Rust agent-ingress listener dies (port bind failed after retries). Every
 * ingress route is dead for the session; the user is told instead of the
 * failure staying log-only.
 */

import { onIngressDead } from "../../io/bridge/inbox/ingress-dead";

interface IngressDeadNoticeDeps {
  surfaces: {
    beginSpeech(): void;
    pushSpeech(t: string): void;
    endSpeech(): void;
  };
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Injectable inbox subscriber; defaults to the real onIngressDead. */
  onInbox?: (cb: (p: { port: number }) => void) => () => void;
}

export function wireIngressDeadNotice(deps: IngressDeadNoticeDeps): () => void {
  const subscribe = deps.onInbox ?? onIngressDead;
  return subscribe((p) => {
    deps.surfaces.beginSpeech();
    deps.surfaces.pushSpeech(deps.t("ingress.dead_notice", { port: p.port }));
    deps.surfaces.endSpeech();
  });
}
