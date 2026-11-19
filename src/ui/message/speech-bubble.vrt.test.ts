import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../styles.css";
import { createSurfaces } from "../surfaces/surfaces";
import { noTool } from "../surfaces/test-helpers";

beforeEach(() => {
  document.body.innerHTML =
    '<div id="app"><div class="yui-root"><div class="yui-stage"></div></div></div>';
});

it.each(["dawn", "hearth"] as const)("paints the speech bubble in %s", async (theme) => {
  let allShown!: () => void;
  const shown = new Promise<void>((resolve) => {
    allShown = resolve;
  });
  const surfaces = createSurfaces({
    mount: document.querySelector<HTMLElement>(".yui-root")!,
    tool: noTool,
    keepBubbleUntilDismissed: () => true,
    onAllShown: allShown,
  });
  surfaces.beginSpeech();
  surfaces.pushSpeech("I kept the **kettle** warm.\n\n");
  surfaces.pushSpeech("- the report is ready\n- the rain stops by evening");
  surfaces.endSpeech();
  await shown;
  await document.fonts.ready;
  await page.viewport(400, 600);
  document.documentElement.dataset.theme = theme;
  await expect
    .element(page.elementLocator(document.querySelector("#app")!))
    .toMatchScreenshot(`speech-bubble-${theme}`);
  surfaces.dispose();
});
