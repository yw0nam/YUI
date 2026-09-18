// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../logger";
import { bindSlider } from "./slider-binding";

function setup() {
  const slider = document.createElement("input");
  slider.type = "range";
  slider.value = "7";
  document.body.append(slider);
  const log = { info: vi.fn() } as unknown as Logger;
  const setValue = vi.fn();
  const onInputExtra = vi.fn();
  const onEndExtra = vi.fn();
  const detach = bindSlider(
    {
      slider,
      parse: (raw: string) => parseInt(raw, 10),
      setValue,
      logKey: "test_change",
      logField: "val",
      onInputExtra,
      onEndExtra,
    },
    log,
  );
  return { slider, log, setValue, onInputExtra, onEndExtra, detach };
}

describe("bindSlider", () => {
  it("input parses, sets the value, then runs the extra side effect", () => {
    const { slider, setValue, onInputExtra } = setup();
    slider.value = "42";
    slider.dispatchEvent(new Event("input"));
    expect(setValue).toHaveBeenCalledWith(42);
    expect(onInputExtra).toHaveBeenCalledWith(42);
  });

  it("pointerup and blur run the end side effect then log the parsed value", () => {
    const { slider, log, onEndExtra } = setup();
    slider.value = "5";
    slider.dispatchEvent(new PointerEvent("pointerup"));
    slider.dispatchEvent(new Event("blur"));
    expect(onEndExtra).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith("test_change", { val: 5 });
  });

  it("the returned function detaches all listeners", () => {
    const { slider, log, setValue, onInputExtra, onEndExtra, detach } = setup();
    detach();
    slider.dispatchEvent(new Event("input"));
    slider.dispatchEvent(new PointerEvent("pointerup"));
    slider.dispatchEvent(new Event("blur"));
    expect(setValue).not.toHaveBeenCalled();
    expect(onInputExtra).not.toHaveBeenCalled();
    expect(onEndExtra).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });
});
