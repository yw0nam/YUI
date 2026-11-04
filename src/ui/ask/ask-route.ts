import type { AskFrame } from "../../io/chat/push/push-frames";
import type { Surfaces } from "../surfaces/surfaces";

type AskSide = Pick<Surfaces, "setAsks" | "onAskAnswer">;

export function createAskRoute(target: () => AskSide, sides: AskSide[]) {
  let frames: AskFrame[] | undefined;
  let previous: AskSide | undefined;
  function resend(): void {
    if (frames === undefined) return;
    const side = target();
    if (previous && side !== previous) previous.setAsks([]);
    previous = side;
    side.setAsks(frames);
  }
  return {
    setAsks(value: AskFrame[]): void {
      frames = value;
      resend();
    },
    onAskAnswer(cb: Parameters<Surfaces["onAskAnswer"]>[0]): void {
      for (const side of sides) side.onAskAnswer(cb);
    },
    resend,
  };
}
