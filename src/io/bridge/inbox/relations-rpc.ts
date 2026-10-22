/** Answers the ingress `/relations` routes, bridged over the avatar RPC channel, from this window's relation store. */

import { createLogger } from "../../../logger";
import type { RelationsStore } from "../../../settings/relations/relations-store";
import type { AvatarRpcRequest } from "./avatar-rpc";

const log = createLogger("relations-rpc");

export function createRelationsRpc(deps: {
  subscribe: (cb: (req: AvatarRpcRequest) => void) => () => void;
  respond: (id: string, result: unknown) => void;
  store: Pick<RelationsStore, "all" | "replace">;
}): { start(): void; stop(): void } {
  let unsubscribe: (() => void) | undefined;
  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = deps.subscribe((req) => {
        if (req.method === "relations_get") deps.respond(req.id, deps.store.all());
        if (req.method !== "relations_put") return;
        // The ingress refused an invalid body already; this is the storage guard's answer.
        if (!deps.store.replace(req.params)) {
          deps.respond(req.id, { ok: false, reason: "invalid" });
          return;
        }
        const stored = deps.store.all();
        log.info("relations_replaced", { targets: Object.keys(stored) });
        deps.respond(req.id, stored);
      });
    },
    stop() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}
