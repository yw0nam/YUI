// SPIKE #1971 (never merged): debug — does a synthetic pointermove put the stage into passthrough, and what flips it back.
import { S } from "./lib.mjs";

export default async function (h, steps) {
  const X = (e) => h.exec(S(e));
  const series = async (label, n = 10) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push((await X('s.native("state")')).ignores_mouse);
      await h.sleep(100);
    }
    steps[label] = out.join("");
  };
  await series("t0_before");
  await X("s.synthMove(5, 5, 3)");
  await series("t1_after_synth_real_cursor", 20);
  await X("s.blockTrusted(true)");
  await X("s.fakeCursor(5, 5)");
  await X("s.synthMove(5, 5, 3)");
  await series("t2_after_synth_fake_cursor", 20);
  steps.ui = await h.exec(
    `[...document.querySelectorAll(".yui-status, .yui-bubble, .yui-threadchip, .yui-sigchips")].map(e => ({c: e.className, r: e.getBoundingClientRect().toJSON(), d: getComputedStyle(e).display}))`,
  );
  await X("s.fakeCursor(null)");
  await X("s.blockTrusted(false)");
}
