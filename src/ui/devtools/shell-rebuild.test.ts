// @vitest-environment jsdom

import { afterEach, expect, it, type Mock, vi } from "vitest";
import { createLocaleRebuilder } from "./shell-rebuild";

type Section = "context" | "advanced" | "motion";

// jsdom lacks CSS.escape; mirrors the real escape's handling of the characters used here.
if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== "function") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (value: string) =>
      // biome-ignore lint/suspicious/noControlCharactersInRegex: mirror the real escape's control-char handling.
      String(value).replace(/[\x00-\x7f]/g, (ch) => (/[a-zA-Z0-9_-]/.test(ch) ? ch : `\\${ch}`)),
  };
}

const mount = document.createElement("div");
const log = { error: vi.fn() };
let rebuilder: ReturnType<typeof createLocaleRebuilder> | undefined;

interface FakeShell {
  readonly active: Section;
  activate: Mock<(section: Section) => Promise<void>>;
  dispose: Mock<() => void>;
}

/** Fake shells render a nav button per section and an advanced input; the motion section adds a select. */
function fakeShells(motionLoad?: (build: number) => Promise<void>) {
  const shells: FakeShell[] = [];
  const build = () => {
    const number = shells.length + 1;
    let active: Section = "context";
    mount.replaceChildren();
    for (const section of ["context", "advanced", "motion"]) {
      const button = document.createElement("button");
      button.dataset.section = section;
      mount.append(button);
    }
    const input = document.createElement("input");
    input.id = "ctx-window";
    mount.append(input);
    const shell: FakeShell = {
      get active() {
        return active;
      },
      activate: vi.fn(async (section: Section) => {
        active = section;
        if (section !== "motion") return;
        await motionLoad?.(number);
        mount.insertAdjacentHTML(
          "beforeend",
          '<select id="sel"><option value="idle">idle</option><option value="wave">wave</option></select>',
        );
      }),
      dispose: vi.fn(() => mount.replaceChildren()),
    };
    shells.push(shell);
    return shell;
  };
  return { shells, build };
}

function start(fake: ReturnType<typeof fakeShells>) {
  document.body.append(mount);
  rebuilder = createLocaleRebuilder({ mount, build: fake.build as never, log });
  return rebuilder;
}

afterEach(() => {
  rebuilder?.dispose();
  rebuilder = undefined;
  mount.remove();
  mount.replaceChildren();
  log.error.mockClear();
});

it("keeps the focused input and its in-progress text across a rebuild", async () => {
  const fake = fakeShells();
  const { rebuild } = start(fake);
  const input = mount.querySelector<HTMLInputElement>("#ctx-window")!;
  input.focus();
  input.value = "64000";
  const changed = vi.fn();
  // The restore dispatches a non-bubbling change, so only the capture phase sees it on mount.
  mount.addEventListener("change", changed, true);

  rebuild();
  await vi.waitFor(() => expect(fake.shells).toHaveLength(2));
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());

  const rebuilt = mount.querySelector<HTMLInputElement>("#ctx-window")!;
  expect(rebuilt).not.toBe(input);
  expect(document.activeElement).toBe(rebuilt);
  expect(rebuilt.value).toBe("64000");
});

it("keeps the active section and the focus on its nav button across a rebuild", async () => {
  const fake = fakeShells();
  const { rebuild } = start(fake);
  await fake.shells[0]!.activate("advanced");
  const advanced = mount.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
  advanced.focus();

  rebuild();
  await vi.waitFor(() => expect(fake.shells).toHaveLength(2));
  await vi.waitFor(() => expect(fake.shells[1]!.activate).toHaveBeenCalledWith("advanced"));

  const rebuilt = mount.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
  expect(rebuilt).not.toBe(advanced);
  expect(document.activeElement).toBe(rebuilt);
});

it("restores the focused motion select and its selection after activate resolves", async () => {
  const fake = fakeShells();
  const { rebuild } = start(fake);
  await fake.shells[0]!.activate("motion");
  const select = mount.querySelector<HTMLSelectElement>("#sel")!;
  select.focus();
  select.value = "wave";

  rebuild();
  await vi.waitFor(() => expect(fake.shells).toHaveLength(2));
  await vi.waitFor(() => expect(document.activeElement?.id).toBe("sel"));

  const rebuilt = mount.querySelector<HTMLSelectElement>("#sel")!;
  expect(rebuilt).not.toBe(select);
  expect(rebuilt.value).toBe("wave");
});

it("continues rebuilds after an activate rejects and logs the failure", async () => {
  const fake = fakeShells(async (build) => {
    if (build === 2) throw new Error("preview load failed");
  });
  const { rebuild } = start(fake);
  await fake.shells[0]!.activate("motion");

  rebuild();
  await vi.waitFor(() => expect(log.error).toHaveBeenCalledOnce());
  expect(log.error).toHaveBeenCalledWith("locale_rebuild_failed", {
    error: "Error: preview load failed",
  });

  rebuild();
  await vi.waitFor(() => expect(fake.shells).toHaveLength(3));
  await vi.waitFor(() => expect(mount.querySelector("#sel")).not.toBeNull());
  expect(fake.shells[1]!.activate).toHaveBeenCalledWith("motion");
  expect(fake.shells[2]!.activate).toHaveBeenCalledWith("motion");
});

it("serializes rapid rebuilds and keeps one live shell", async () => {
  let release = () => {};
  const fake = fakeShells(async (build) => {
    if (build === 2) await new Promise<void>((resolve) => (release = resolve));
  });
  const { rebuild } = start(fake);
  await fake.shells[0]!.activate("motion");

  rebuild();
  await vi.waitFor(() => expect(fake.shells).toHaveLength(2));
  rebuild();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(fake.shells).toHaveLength(2);
  expect(mount.querySelector("#sel")).toBeNull();

  release();
  await vi.waitFor(() => expect(fake.shells).toHaveLength(3));
  await vi.waitFor(() => expect(mount.querySelector("#sel")).not.toBeNull());
  const live = fake.shells.filter((shell) => shell.dispose.mock.calls.length === 0);
  expect(live).toEqual([fake.shells[2]]);
});
