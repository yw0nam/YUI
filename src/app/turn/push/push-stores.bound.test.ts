import { expect, it, vi } from "vitest";
import { createSettingsBridge } from "../../../io/bridge/settings-bridge";
import { publishPushStores } from "./push-stores";

it.each([true, false])("every pet publishes settings-window push state (bound: %s)", (bound) => {
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
  publishPushStores(stores, bridge, () => {}, { bound });
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(onAsk).toHaveBeenCalledTimes(1);
  bridge.dispose();
});
