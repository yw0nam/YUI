// @vitest-environment jsdom
/** motion-page.test.tsx — the Motion page's gain preview: when it ends and what it logs. */

import { fireEvent, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger";
import { createLipsyncSettings } from "../../../settings/avatar/lipsync-settings";
import { setLocale } from "../../i18n";
import { createMotionPage } from "./motion-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pages: ReturnType<typeof createMotionPage>[] = [];

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
});

it("keeps a keyboard preview running until blur, which ends it and logs the gain", () => {
  setLocale("en");
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const onPreviewEnd = vi.fn();
  const page = createMotionPage({
    rows: [],
    lipsync: createLipsyncSettings({ storage: { load: () => null, save: () => {} } }),
    onPreview: vi.fn(),
    onPreviewEnd,
    isOpen: () => true,
    log,
    host: document.body,
  });
  pages.push(page);
  const slider = within(page.el).getByRole("slider");
  act(() => slider.focus());

  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(onPreviewEnd).not.toHaveBeenCalled();
  expect(log.info).not.toHaveBeenCalled();

  act(() => slider.blur());
  expect(onPreviewEnd).toHaveBeenCalledOnce();
  expect(log.info).toHaveBeenCalledWith("mouth_gain_change", { gain: 2.1 });
});
