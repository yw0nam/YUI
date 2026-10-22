import { describe, expect, it } from "vitest";
import { createRelationsStore } from "../../../settings/relations/relations-store";
import type { AvatarRpcRequest } from "./avatar-rpc";
import { createRelationsRpc } from "./relations-rpc";

const BODY = { user: { value: 5, updated_at: 1, log: [{ at: 1, delta: 2, why: "x" }] } };

function harness() {
  let handler: ((req: AvatarRpcRequest) => void) | undefined;
  const responses: { id: string; result: unknown }[] = [];
  const store = createRelationsStore({ storage: { load: () => BODY, save: () => {} } });
  createRelationsRpc({
    subscribe: (cb) => {
      handler = cb;
      return () => {};
    },
    respond: (id, result) => responses.push({ id, result }),
    store,
  }).start();
  return { store, responses, call: (req: AvatarRpcRequest) => handler?.(req) };
}

describe("createRelationsRpc", () => {
  it("answers relations_get with the store's contents", () => {
    const h = harness();
    h.call({ id: "r1", method: "relations_get" });

    expect(h.responses).toEqual([{ id: "r1", result: BODY }]);
  });

  it("replaces the store on relations_put and answers the stored body", () => {
    const h = harness();
    const next = { aaaa0001: { value: -6, updated_at: 2, log: [], note: "doubts the promises" } };
    h.call({ id: "r1", method: "relations_put", params: next });

    expect(h.store.all()).toEqual(next);
    expect(h.responses).toEqual([{ id: "r1", result: next }]);
  });

  it("answers an invalid body with invalid and leaves the store unchanged", () => {
    const h = harness();
    h.call({ id: "r1", method: "relations_put", params: "x" });

    expect(h.store.all()).toEqual(BODY);
    expect(h.responses).toEqual([{ id: "r1", result: { ok: false, reason: "invalid" } }]);
  });
});
