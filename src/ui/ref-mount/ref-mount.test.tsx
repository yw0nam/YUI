// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RefMount } from "./ref-mount";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => cleanup());
  document.body.innerHTML = "";
});

function setup() {
  const cleanups: number[] = [];
  const mount = vi.fn((host: HTMLElement) => {
    const n = mount.mock.calls.length;
    host.append(`mounted ${n}`);
    return () => cleanups.push(n);
  });
  const { container, rerender, unmount } = render(
    <RefMount className="host" mount={mount} deps={["a"]} />,
  );
  const host = container.querySelector<HTMLElement>(".host")!;
  return { mount, cleanups, host, rerender, unmount };
}

it("mounts once into its host and keeps what it put there across a render with the same deps", () => {
  const { mount, host, rerender } = setup();

  rerender(<RefMount className="host" mount={mount} deps={["a"]} />);

  expect(mount.mock.calls).toEqual([[host]]);
  expect(host.textContent).toBe("mounted 1");
});

it("cleans up and mounts again when its deps change", () => {
  const { mount, cleanups, host, rerender } = setup();

  rerender(<RefMount className="host" mount={mount} deps={["b"]} />);

  expect(cleanups).toEqual([1]);
  expect(mount).toHaveBeenCalledTimes(2);
  expect(host.textContent).toBe("mounted 1mounted 2");
});

it("cleans up on unmount", () => {
  const { cleanups, unmount } = setup();

  act(() => unmount());

  expect(cleanups).toEqual([1]);
});
