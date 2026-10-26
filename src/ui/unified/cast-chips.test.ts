// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createCastChips } from "./cast-chips";

vi.mock("./avatar.css", () => ({}));

const CAST = [
  { id: "perlica", name: "Perlica" },
  { id: "natsume", name: "Natsume" },
  { id: "yui", name: "Yui" },
];

it("shows each open character with the state of its line", () => {
  const mount = document.createElement("div");
  const chips = createCastChips({ mount, onClose: () => {}, startDragging: () => {} });

  chips.render(CAST, (id) => (id === "perlica" ? "talk" : id === "natsume" ? "think" : "idle"));

  expect(
    [...mount.querySelectorAll<HTMLElement>(".yui-uc__chip")].map((c) => [
      c.textContent,
      c.dataset.state,
    ]),
  ).toEqual([
    ["Perlica", "talk"],
    ["Natsume", "think"],
    ["Yui", "idle"],
  ]);
});

it("closes on its × and drags the window from anywhere else on the row", () => {
  const mount = document.createElement("div");
  const onClose = vi.fn();
  const startDragging = vi.fn();
  const chips = createCastChips({ mount, onClose, startDragging });
  chips.render(CAST, () => "idle");
  const close = mount.querySelector<HTMLButtonElement>(".yui-uc__close")!;

  close.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  close.click();
  mount
    .querySelector(".yui-uc__chip")!
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));

  expect(onClose).toHaveBeenCalledOnce();
  expect(startDragging).toHaveBeenCalledOnce();
});
