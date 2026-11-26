import type { AskSlotFrame } from "../../io/chat/tools/run/settings-request-frame";
import type { Surfaces } from "../surfaces/surfaces";

type AskSide = Pick<Surfaces, "setAsks" | "onAskAnswer">;

export function createAskRoute(target: () => AskSide, sides: AskSide[]) {
  let frames: AskSlotFrame[] | undefined;
  let previous: AskSide | undefined;
  function resend(): void {
    if (frames === undefined) return;
    const side = target();
    if (previous && side !== previous) previous.setAsks([]);
    previous = side;
    side.setAsks(frames);
  }
  return {
    setAsks(value: AskSlotFrame[]): void {
      frames = value;
      resend();
    },
    onAskAnswer(cb: Parameters<Surfaces["onAskAnswer"]>[0]): void {
      for (const side of sides) side.onAskAnswer(cb);
    },
    resend,
  };
}
