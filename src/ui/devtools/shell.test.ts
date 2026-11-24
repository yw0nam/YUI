// @vitest-environment jsdom

import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextHistory } from "../../io/chat/conversation/context-history";
import { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import { setLocale } from "../i18n";
import type { LoadMotionPreview } from "./motion-preview/motion-load";
import { createDevtoolsShell } from "./shell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function press(el: Element, key: string) {
  await act(async () => {
    fireEvent.keyDown(el, { key });
  });
}

const tab = (id: string) => document.getElementById(`yui-tab-${id}`);
const panel = (id: string) => document.getElementById(`yui-panel-${id}`);

let shell: ReturnType<typeof createDevtoolsShell> | null = null;

function mountShell(
  loadMotionPreview: LoadMotionPreview = vi.fn(async () => ({ dispose: vi.fn() })),
) {
  const created = createDevtoolsShell({
    mount: document.querySelector("#app")!,
    history: createContextHistory(),
    endpointsSettings: createEndpointsSettings(),
    loadMotionPreview,
  });
  shell = created;
  return created;
}

describe("Developer Tools shell", () => {
  beforeEach(() => {
    setLocale("en");
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    act(() => shell?.dispose());
    shell = null;
    document.body.innerHTML = "";
  });

  it("switches panels and marks the active navigation item", () => {
    mountShell();

    act(() => tab("advanced")!.click());

    expect(tab("advanced")?.getAttribute("aria-selected")).toBe("true");
    expect(panel("advanced")?.hidden).toBe(false);
    expect(panel("context")?.hidden).toBe(true);
  });

  it("selects a section with ArrowDown, End and Home on its yui-tab tab", async () => {
    const shell = mountShell();
    const context = tab("context")!;
    expect(context.getAttribute("role")).toBe("tab");

    act(() => context.focus());
    await press(context, "ArrowDown");
    expect(shell.active).toBe("advanced");
    expect(tab("advanced")?.getAttribute("aria-selected")).toBe("true");
    expect(panel("advanced")?.hidden).toBe(false);

    await press(tab("advanced")!, "End");
    expect(shell.active).toBe("motion");
    await press(tab("motion")!, "Home");
    expect(shell.active).toBe("context");
    expect(document.activeElement).toBe(context);
  });

  it("renders localized window chrome and navigation labels", () => {
    setLocale("ja");
    mountShell();

    expect(document.querySelector(".devtools-header")?.textContent).toBe("開発者ツール");
    expect(screen.queryByRole("tablist", { name: "開発者ツールのセクション" })).not.toBeNull();
    expect(tab("context")?.textContent).toBe("コンテキストインスペクター");
    expect(tab("motion")?.textContent).toBe("モーションプレビュー");
  });

  it("disposes the motion-preview handle on shell dispose", async () => {
    const dispose = vi.fn();
    const shell = mountShell(vi.fn(async () => ({ dispose })));

    await act(() => shell.activate("motion"));
    act(() => shell.dispose());

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes the motion-preview handle once a pending load resolves", async () => {
    const dispose = vi.fn();
    let resolveLoad!: (handle: { dispose(): void }) => void;
    const shell = mountShell(
      vi.fn(
        () =>
          new Promise<{ dispose(): void }>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
    );

    const settled = shell.activate("motion");
    act(() => shell.dispose());
    resolveLoad({ dispose });
    await settled;

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("loads the motion-preview module only on its first activation", async () => {
    const loadMotionPreview = vi.fn(async () => ({ dispose: vi.fn() }));
    const shell = mountShell(loadMotionPreview);

    await act(async () => {
      void shell.activate("motion");
      void shell.activate("context");
      await shell.activate("motion");
    });

    expect(loadMotionPreview).toHaveBeenCalledOnce();
  });

  it("shows an error state when the motion-preview load rejects, not the loading placeholder", async () => {
    const shell = mountShell(
      vi.fn(async () => {
        throw new Error("registry load failed");
      }),
    );

    await act(() => shell.activate("motion"));

    expect(panel("motion")?.querySelector(".devtools-loading")).toBeNull();
    expect(panel("motion")?.querySelector(".devtools-error")?.textContent).toBe(
      "Motion preview failed to load. Select this tab to retry.",
    );
  });

  it("retries the motion-preview load when the section is re-activated after a rejection", async () => {
    const loadMotionPreview = vi
      .fn<LoadMotionPreview>()
      .mockRejectedValueOnce(new Error("registry load failed"))
      .mockResolvedValueOnce({ dispose: vi.fn() });
    const shell = mountShell(loadMotionPreview);

    await act(() => shell.activate("motion"));
    await act(() => shell.activate("context"));
    await act(() => shell.activate("motion"));

    expect(loadMotionPreview).toHaveBeenCalledTimes(2);
  });

  it("retries a failed motion-preview load on a click of the selected Motion tab", async () => {
    const loadMotionPreview = vi
      .fn<LoadMotionPreview>()
      .mockRejectedValueOnce(new Error("registry load failed"))
      .mockResolvedValueOnce({ dispose: vi.fn() });
    const shell = mountShell(loadMotionPreview);
    await act(() => shell.activate("motion"));

    await act(async () => tab("motion")!.click());

    expect(loadMotionPreview).toHaveBeenCalledTimes(2);
    expect(panel("motion")?.querySelector(".devtools-error")).toBeNull();
  });
});
