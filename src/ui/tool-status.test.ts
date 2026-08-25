// @vitest-environment jsdom
/**
 * Tests for the tool-status chip: label resolution and running→done→hide
 * lifecycle, driven through createSurfaces (the mount that composes tool-status.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CSS imports are not handled in jsdom — mock them
vi.mock("./surfaces.css", () => ({}));
vi.mock("./tokens.css", () => ({}));

import { createSurfaces } from "./surfaces";

function makeSurfaces() {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const s = createSurfaces({ mount });
  return { s, mount };
}

describe("showTool — tool_id label resolution", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  it("shows 'Searching…' for tool_id='web_search'", () => {
    s.showTool("web_search");
    const label = mount.querySelector(".yui-tool__label");
    expect(label?.textContent).toBe("Searching…");
  });

  it("shows 'Browsing…' for tool_id='browser'", () => {
    s.showTool("browser");
    const label = mount.querySelector(".yui-tool__label");
    expect(label?.textContent).toBe("Browsing…");
  });

  it("shows 'Running…' for tool_id='terminal'", () => {
    s.showTool("terminal");
    const label = mount.querySelector(".yui-tool__label");
    expect(label?.textContent).toBe("Running…");
  });

  it("humanizes an unmapped tool_id", () => {
    s.showTool("some_unknown_tool");
    const label = mount.querySelector(".yui-tool__label");
    expect(label?.textContent).toBe("Some unknown tool…");
  });

  it("makes tool chip visible", () => {
    s.showTool("web_search");
    const toolEl = mount.querySelector(".yui-tool");
    expect(toolEl?.getAttribute("hidden")).toBeNull();
  });
});

describe("tool chip aria", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  it("keeps the tool chip live (discrete updates)", () => {
    const tool = mount.querySelector(".yui-tool") as HTMLElement;
    expect(tool.getAttribute("aria-live")).toBe("polite");
    expect(tool.getAttribute("role")).toBe("status");
  });
});

describe("tool chip lifecycle (running → done → hide)", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function tool(): HTMLElement {
    return mount.querySelector(".yui-tool") as HTMLElement;
  }

  it("showTool marks the chip running and resolves the label from the tool id", () => {
    s.showTool("web_search");
    const el = tool();
    expect(el.hidden).toBe(false);
    expect(el.dataset.state).toBe("running");
    expect((el.querySelector(".yui-tool__label") as HTMLElement).textContent).toBe("Searching…");
  });

  it("finishTool keeps the tool's label through the done state — the name must not be swapped for a generic 'Done'", () => {
    s.showTool("web_search");
    s.finishTool();
    const el = tool();
    expect((el.querySelector(".yui-tool__label") as HTMLElement).textContent).toBe("Searching…");
    expect(el.dataset.state).toBe("done");
  });

  it("finishTool switches a running chip to done then auto-hides after the 1500ms hold", () => {
    vi.useFakeTimers();
    s.showTool("web_search");
    s.finishTool();
    const el = tool();
    expect(el.dataset.state).toBe("done");

    // Pins the hold constant: not yet at 1499ms, hidden by 1500ms.
    vi.advanceTimersByTime(1499);
    expect(el.classList.contains("is-visible")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains("is-visible")).toBe(false);

    vi.useRealTimers();
  });

  it("finishTool is a no-op when no chip is showing", () => {
    s.finishTool();
    expect(tool().dataset.state).toBeUndefined();
  });
});

describe("dispose — clears the pending tool-hide timer", () => {
  it("stops finishTool's queued hide from mutating the chip after teardown", () => {
    vi.useFakeTimers();
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const s = createSurfaces({ mount });
    const toolEl = mount.querySelector(".yui-tool") as HTMLElement;

    s.showTool("web_search");
    s.finishTool(); // arms the 1500ms toolHideTimer
    s.dispose();

    // 1500ms toolHideTimer + 900ms afterFadeOut fallback, well past both
    vi.advanceTimersByTime(2600);

    expect(toolEl.hidden).toBe(false);

    vi.useRealTimers();
    mount.remove();
  });
});

describe("dispose — cancels an in-flight fade fallback", () => {
  it("stops the 900ms fallback from mutating the chip after teardown mid-fade", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const s = createSurfaces({ mount });
    const toolEl = mount.querySelector(".yui-tool") as HTMLElement;

    s.showTool("web_search");
    s.finishTool(); // arms the 1500ms toolHideTimer
    vi.advanceTimersByTime(1500); // toolHideTimer fires -> hideTool() arms the 900ms fade fallback
    s.dispose();
    vi.advanceTimersByTime(900); // fallback would fire here if not cancelled

    expect(toolEl.hidden).toBe(false);

    vi.useRealTimers();
    mount.remove();
  });
});

describe("disposed guard — late async calls after teardown are no-ops", () => {
  it("finishTool() after dispose() does not re-arm the hide timer", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const s = createSurfaces({ mount });
    const toolEl = mount.querySelector(".yui-tool") as HTMLElement;

    s.showTool("web_search");
    s.dispose();
    s.finishTool(); // late async onToolStatus callback landing after teardown

    vi.advanceTimersByTime(2600);
    expect(toolEl.dataset.state).toBe("running");
    expect(toolEl.hidden).toBe(false);

    vi.useRealTimers();
    mount.remove();
  });
});

describe("tool-status hide fallback", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    vi.useRealTimers();
  });

  function opacityTransitionEnd(el: HTMLElement): void {
    const event = new Event("transitionend") as TransitionEvent & { propertyName: string };
    Object.defineProperty(event, "propertyName", { value: "opacity", configurable: true });
    el.dispatchEvent(event);
  }

  it("hideTool settles after 900ms without transitionend and repeated stray hides stay harmless", () => {
    const tool = mount.querySelector(".yui-tool") as HTMLElement;
    s.showTool("web_search");

    s.hideTool();
    s.hideTool();
    expect(tool.hidden).toBe(false);

    vi.advanceTimersByTime(900);
    expect(tool.hidden).toBe(true);

    s.showTool("browser");
    tool.classList.add("is-visible");
    opacityTransitionEnd(tool);
    expect(tool.hidden).toBe(false);
  });
});

// A webview stops painting while its window is occluded: queued frames run only when it
// comes back, long after the hide already settled.
describe("tool-status — a frame deferred past the hide", () => {
  function stubFrames(): { flush: () => void } {
    const pending = new Map<number, FrameRequestCallback>();
    let next = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      pending.set(next, cb);
      return next++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
    return {
      flush: () => {
        for (const cb of [...pending.values()]) cb(0);
        pending.clear();
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("never re-shows the chip after hideTool", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { flush } = stubFrames();
    const { s, mount } = makeSurfaces();
    const toolEl = mount.querySelector(".yui-tool") as HTMLElement;

    s.showTool("mcp_tts_express_server_get_ids");
    s.hideTool();
    vi.advanceTimersByTime(900); // fade fallback settles the chip hidden
    flush(); // the window paints again

    expect(toolEl.classList.contains("is-visible")).toBe(false);

    s.dispose();
    mount.remove();
  });

  it("never re-shows the chip after finishTool's auto-hide", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { flush } = stubFrames();
    const { s, mount } = makeSurfaces();
    const toolEl = mount.querySelector(".yui-tool") as HTMLElement;

    s.showTool("mcp_tts_express_server_get_ids");
    s.finishTool();
    vi.advanceTimersByTime(2400); // 1500ms hold + 900ms fade fallback
    flush();

    expect(toolEl.classList.contains("is-visible")).toBe(false);

    s.dispose();
    mount.remove();
  });

  it("re-showing while a dismiss fade is still in flight leaves the chip visible, not hidden by the stale settle", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { flush } = stubFrames();
    const { s, mount } = makeSurfaces();
    const toolEl = mount.querySelector(".yui-tool") as HTMLElement;

    s.showTool("web_search");
    flush();
    s.finishTool(); // arms the 1500ms hold
    vi.advanceTimersByTime(1500); // hold fires -> hideTool() removes is-visible, arms the 900ms fallback

    s.showTool("terminal"); // re-show while the old dismiss fade is still pending — is-visible
    // isn't back yet (the new show's rAF hasn't run), so the stale settle's own is-visible check
    // can't save it: only showTool() cancelling the stale fade outright can.
    vi.advanceTimersByTime(900); // the stale fade's fallback fires here if not cancelled
    flush(); // now the new show's rAF finally re-adds is-visible

    expect(toolEl.hidden).toBe(false);
    expect(toolEl.classList.contains("is-visible")).toBe(true);

    s.dispose();
    mount.remove();
  });

  it("still shows the chip when the frame runs normally", () => {
    const { flush } = stubFrames();
    const { s, mount } = makeSurfaces();
    const toolEl = mount.querySelector(".yui-tool") as HTMLElement;

    s.showTool("web_search");
    flush();

    expect(toolEl.classList.contains("is-visible")).toBe(true);

    s.dispose();
    mount.remove();
  });
});
