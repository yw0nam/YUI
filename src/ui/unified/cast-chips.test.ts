// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { type CastState, createCastChips } from "./cast-chips";

vi.mock("./avatar.css", () => ({}));

const CAST = [
  { id: "perlica", name: "Perlica" },
  { id: "natsume", name: "Natsume" },
  { id: "yui", name: "Yui" },
];

function setup(onPick: (id: string) => void = () => {}) {
  document.body.innerHTML = "";
  const mount = document.createElement("div");
  document.body.append(mount);
  const onClose = vi.fn();
  const startDragging = vi.fn();
  const chips = createCastChips({ mount, onClose, startDragging, onPick });
  const radios = () => [...mount.querySelectorAll<HTMLElement>("[role=radio]")];
  return { mount, chips, onClose, startDragging, radios };
}

it("shows each open character with the state of its line, then everyone", () => {
  const { chips, mount } = setup();

  chips.render(
    CAST,
    (id) => (id === "perlica" ? "talk" : id === "natsume" ? "think" : "idle"),
    "yui",
  );

  expect(
    [...mount.querySelectorAll<HTMLElement>(".yui-uc__chip")].map((c) => [
      c.textContent,
      c.dataset.state,
    ]),
  ).toEqual([
    ["Perlica", "talk"],
    ["Natsume", "think"],
    ["Yui", "idle"],
    ["everyone", undefined],
  ]);
});

it("is a radio group whose checked chip holds the tab stop, and a click picks", () => {
  const picked: string[] = [];
  const { chips, mount, radios } = setup((id) => picked.push(id));

  chips.render(CAST, () => "idle", "natsume");
  radios()[3]!.click();

  expect(mount.querySelector("[role=radiogroup]")?.getAttribute("aria-label")).toBe("Send to");
  expect(radios().map((r) => [r.dataset.id, r.getAttribute("aria-checked"), r.tabIndex])).toEqual([
    ["perlica", "false", -1],
    ["natsume", "true", 0],
    ["yui", "false", -1],
    ["everyone", "false", -1],
  ]);
  expect(picked).toEqual(["everyone"]);
});

it("picks on a click whose press came before a state repaint", () => {
  const picked: string[] = [];
  const { chips, radios } = setup((id) => picked.push(id));
  chips.render(CAST, () => "idle", "perlica");
  const chip = radios()[1]!;

  chip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  chips.render(CAST, (id) => (id === "natsume" ? "talk" : "idle"), "perlica");
  chip.click();

  expect(picked).toEqual(["natsume"]);
});

it("closes on its ×, and drags the window from the row's empty space only", () => {
  const { chips, mount, onClose, startDragging, radios } = setup();
  chips.render(CAST, () => "idle", "perlica");
  const down = () => new PointerEvent("pointerdown", { bubbles: true, button: 0 });

  const close = mount.querySelector<HTMLButtonElement>(".yui-uc__close")!;
  close.dispatchEvent(down());
  close.click();
  radios()[0]!.dispatchEvent(down());
  expect(startDragging).not.toHaveBeenCalled();

  mount.querySelector(".yui-uc__cast")!.dispatchEvent(down());

  expect(onClose).toHaveBeenCalledOnce();
  expect(startDragging).toHaveBeenCalledOnce();
});

it.each([
  { key: "ArrowRight", from: "natsume", to: "yui" },
  { key: "ArrowDown", from: "everyone", to: "perlica" },
  { key: "ArrowLeft", from: "perlica", to: "everyone" },
  { key: "ArrowUp", from: "natsume", to: "perlica" },
  { key: "Home", from: "yui", to: "perlica" },
  { key: "End", from: "perlica", to: "everyone" },
])("$key from $from picks and focuses $to", ({ key, from, to }) => {
  const picked: string[] = [];
  const { chips, radios } = setup((id) => {
    picked.push(id);
    chips.render(CAST, () => "idle", id);
  });
  chips.render(CAST, () => "idle", from);
  const chip = radios().find((r) => r.dataset.id === from)!;
  chip.focus();

  chip.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  expect(picked).toEqual([to]);
  expect((document.activeElement as HTMLElement).dataset.id).toBe(to);
});

it("keeps a focused chip focused when the states repaint", () => {
  const { chips, radios } = setup();
  chips.render(CAST, () => "idle", "perlica");
  radios()[1]!.focus();

  const talk: (id: string) => CastState = (id) => (id === "natsume" ? "talk" : "idle");
  chips.render(CAST, talk, "perlica");

  expect((document.activeElement as HTMLElement).dataset.id).toBe("natsume");
});

it("keeps a tab stop with nothing checked, and focus when the focused chip's preset leaves", () => {
  const { chips, radios } = setup();
  chips.render(CAST, () => "idle", undefined);
  expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);

  radios()[1]!.focus();
  chips.render([CAST[0]!, CAST[2]!], () => "idle", "yui");

  expect((document.activeElement as HTMLElement).dataset.id).toBe("yui");
});
