/**
 * vrm-participant.bench.ts
 *
 * Frame-time non-regression evidence for the animate()-loop orchestration change
 * (issue #521 part 1): stubbed pins/gaze/emotion/mouth participants, comparing the
 * old hand-sequenced call style (four named calls + an OR-chain) against the new
 * fixed-order array dispatched through stepParticipants/anyConverging. Real-GPU
 * frame-time is not measurable headlessly here — see the PR's Runtime-evidence
 * section for what to check on a real device.
 *
 * Run: npx vitest bench src/renderer/vrm-participant.bench.ts
 */

import { afterAll, bench, describe } from "vitest";
import { anyConverging, stepParticipants, type VrmParticipant } from "./vrm-participant";

const ctx = { vrm: {} as never, dt: 0.016, elapsed: 1.2 };

// Stand-ins for pins/gaze/emotion/mouth — cheap arithmetic only, no DOM/GL, so the
// benchmark isolates dispatch overhead rather than the sub-controllers' own work.
let sink = 0;
function makeParticipant(converging: boolean): VrmParticipant {
  return {
    step: (c) => {
      sink += c.dt;
    },
    isConverging: () => converging,
  };
}

const participants = [
  makeParticipant(false),
  makeParticipant(false),
  makeParticipant(true),
  makeParticipant(false),
];
const [pins, gaze, emotion, mouth] = participants as [
  VrmParticipant,
  VrmParticipant,
  VrmParticipant,
  VrmParticipant,
];

describe("animate() per-frame dispatch: hand-sequenced vs. participant loop", () => {
  bench("hand-sequenced calls (pre-#521 shape)", () => {
    pins.step(ctx);
    gaze.step(ctx);
    emotion.step(ctx);
    mouth.step(ctx);
    const active =
      (pins.isConverging?.() ?? false) ||
      (gaze.isConverging?.() ?? false) ||
      (emotion.isConverging?.() ?? false) ||
      (mouth.isConverging?.() ?? false);
    if (active) sink += 1;
  });

  bench("stepParticipants + anyConverging (post-#521 shape)", () => {
    stepParticipants(participants, ctx);
    if (anyConverging(participants)) sink += 1;
  });
});

// Read sink so V8 can't fold the accumulation above away as dead code.
afterAll(() => {
  if (!Number.isFinite(sink)) throw new Error("unreachable");
});
