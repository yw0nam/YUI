import { expect, it, vi } from "vitest";
import { createSettingsBridge } from "../../../io/bridge/settings-bridge";
import { publishPushStores } from "./push-stores";

it("publishes push state and accepts reset requests for pet companions", () => {
  const bridge = createSettingsBridge(
    { emit: () => {}, listen: () => () => {} },
    { windowKind: "pet" },
  );
  const onReset = vi.spyOn(bridge, "onPushReset"),
    onAsk = vi.spyOn(bridge, "onPushStateAsk");
  const subscribe = () => () => {};
  const stores = {
    pushSocket: { getState: () => ({ kind: "disconnected" }), onState: subscribe },
    delegations: { get: () => [], subscribe },
    reasoning: { get: () => ({}), subscribe },
  } as unknown as Parameters<typeof publishPushStores>[0];
  publishPushStores(stores, bridge, () => {});
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(onAsk).toHaveBeenCalledTimes(1);
  bridge.dispose();
});
