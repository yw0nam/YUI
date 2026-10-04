import { describe, expect, it, vi } from "vitest";
import { createDelegationsStore } from "../../../io/bridge/delegations/delegations-store";
import {
  createMessageWindowSettings,
  type MessageWindowMode,
} from "../../../settings/panels/message-window-settings";

const { createDelegationChip } = vi.hoisted(() => ({ createDelegationChip: vi.fn() }));
vi.mock("../../../ui/chips/delegation-chip", () => ({ createDelegationChip }));

import { createDelegationChipMount, messageWindowSuppression } from "./delegation-chip-mount";

describe("createDelegationChipMount", () => {
  function setup(suppressed: boolean | undefined) {
    let hidden = suppressed;
    const subs = new Set<() => void>();
    const chip = {
      el: {},
      setSuppressed: vi.fn(),
      dispose: vi.fn(),
    };
    createDelegationChip.mockReturnValue(chip);
    const delegations = createDelegationsStore();
    const mount = createDelegationChipMount({
      mount: {} as HTMLElement,
      store: delegations,
      pushState: { getState: () => ({ kind: "disconnected" }), onState: () => () => {} },
      onOpenSettings: () => {},
      ...(suppressed === undefined
        ? {}
        : {
            suppression: {
              get: () => hidden!,
              subscribe: (cb: () => void) => {
                subs.add(cb);
                return () => {
                  subs.delete(cb);
                };
              },
            },
          }),
    });
    return {
      mount,
      chip,
      delegations,
      subs,
      setSuppressed(next: boolean) {
        hidden = next;
        for (const cb of subs) cb();
      },
    };
  }

  it("begins suppressed while the port reads hidden", () => {
    const { mount, chip, delegations } = setup(true);

    mount.create();

    expect(createDelegationChip).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ store: delegations, suppressed: true }),
    );
    expect(chip.setSuppressed).not.toHaveBeenCalled();
  });

  it("follows the suppression port once created", () => {
    const { mount, chip, setSuppressed } = setup(false);
    mount.create();

    setSuppressed(true);
    expect(chip.setSuppressed).toHaveBeenLastCalledWith(true);

    setSuppressed(false);
    expect(chip.setSuppressed).toHaveBeenLastCalledWith(false);
  });

  it("never suppresses when the host passes no port", () => {
    const { mount, chip } = setup(undefined);
    mount.create();

    const created = (createDelegationChip.mock.lastCall as unknown[])[0] as {
      suppressed?: boolean;
    };
    expect(created.suppressed).toBeUndefined();
    expect(chip.setSuppressed).not.toHaveBeenCalled();
  });

  it("removes the suppression subscription and the resources on dispose, idempotently", () => {
    const { mount, chip, subs, setSuppressed } = setup(false);
    mount.create();

    const chipCollapsed = (createDelegationChip.mock.lastCall as unknown[])[0] as {
      collapsed: { dispose: () => void };
    };
    const settingsDispose = vi.spyOn(chipCollapsed.collapsed, "dispose");
    const suppressedCount = chip.setSuppressed.mock.calls.length;

    mount.dispose();
    expect(settingsDispose).toHaveBeenCalledOnce();
    expect(chip.dispose).toHaveBeenCalledOnce();
    expect(subs.size).toBe(0);

    setSuppressed(true);
    expect(chip.setSuppressed).toHaveBeenCalledTimes(suppressedCount);

    mount.dispose();
    expect(settingsDispose).toHaveBeenCalledOnce();
    expect(chip.dispose).toHaveBeenCalledOnce();
  });

  it("builds the pet's suppression port from the pet's own mode reader", () => {
    const store = createMessageWindowSettings();
    // The pet's reader carries the isTauri guard — outside Tauri it answers docked.
    let readerMode: MessageWindowMode = "docked";
    const subs = new Set<() => void>();
    const port = messageWindowSuppression({
      getMode: () => readerMode,
      subscribe: (cb: () => void) => {
        subs.add(cb);
        return () => {
          subs.delete(cb);
        };
      },
    });

    store.setMode("popped");
    expect(port.get()).toBe(false);

    readerMode = "popped";
    expect(port.get()).toBe(true);

    let notified = 0;
    port.subscribe(() => notified++);
    for (const cb of [...subs]) cb();
    expect(notified).toBe(1);
  });
});
