import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../styles.css";
import { createFlagSettings } from "../../settings/persisted-store";
import { createFillerSettings } from "../../settings/voice/filler-settings";
import { createVadSettings } from "../../settings/voice/vad-settings";
import { setLocale } from "../i18n";
import { createSwitchRows } from "../quick-controls/switch-row";
import { createQuickCard } from "./quick-card";

const picker = (options: { id: string; label: string }[]) => ({
  options: () => options,
  current: () => options[0]!.id,
  select: async () => {},
  subscribe: () => () => {},
});

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
});

it.each(["dawn", "hearth"] as const)("paints the quick card in %s", async (theme) => {
  const dnd = createFlagSettings(false);
  const rows = createSwitchRows({
    idleThrottleSettings: createFlagSettings(false),
    vad: createVadSettings(),
    fillerSettings: createFillerSettings(),
    ttsSettings: createFlagSettings(true),
    bubblePersistSettings: createFlagSettings(false),
    unifiedChatSwitch: createFlagSettings(false),
  });
  const row = (selector: string) => rows.find((r) => r.selector === selector)!;
  const card = createQuickCard({
    mount: document.querySelector<HTMLElement>("#app")!,
    entry: () => ({ id: "yui", name: "Yui" }),
    subscribeEntry: () => () => {},
    transport: () => ({ api: "responses" }),
    onTransport: () => () => {},
    tiles: {
      voice: row(".yui-tts-switch"),
      bubble: row(".yui-bubble-persist-switch"),
      unified: row(".yui-unified-switch"),
    },
    listen: { get: () => false, set: () => {}, subscribe: () => () => {} },
    body: picker([{ id: "carlotta", label: "Carlotta" }]),
    voice: picker([{ id: "natsume", label: "Natsume" }]),
    resetConversation: () => {},
    turnOff: () => {},
    openAllSettings: () => {},
    openThreads: () => {},
    dnd: {
      get: () => dnd.get().enabled,
      set: (on) => dnd.setEnabled(on),
      subscribe: (cb) => dnd.subscribe(() => cb()),
    },
  });
  card.open();
  // The window grows to the card: its height plus the 8px margin each side.
  await document.fonts.ready;
  await page.viewport(288, card.el.offsetHeight + 16);
  document.documentElement.dataset.theme = theme;
  await expect
    .element(page.elementLocator(document.querySelector("#app")!))
    .toMatchScreenshot(`quick-card-${theme}`);
});
