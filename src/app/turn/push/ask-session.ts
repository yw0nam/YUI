import type { AskAnswer, AskFrame } from "../../../io/chat/push/push-frames";
import type { PushSocket } from "../../../io/chat/push/push-socket";
import type { Surfaces } from "../../../ui/surfaces/surfaces";

export function createAskSession({
  socket,
  surfaces,
  now = Date.now,
}: {
  socket: Pick<PushSocket, "onAsk" | "onAskEnd" | "onState" | "sendAnswer">;
  surfaces: Pick<Surfaces, "setAsks" | "onAskAnswer">;
  now?: () => number;
}): () => void {
  let open: AskFrame[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function publish(): void {
    clearTimeout(timer);
    const time = now();
    open = open.filter((frame) => frame.expires_at === undefined || frame.expires_at > time);
    surfaces.setAsks([...open]);
    const deadlines = open.flatMap((frame) =>
      frame.expires_at === undefined ? [] : [frame.expires_at],
    );
    if (deadlines.length) timer = setTimeout(publish, Math.min(...deadlines) - time);
  }

  function remove(id: string): void {
    open = open.filter((frame) => frame.ask.ask_id !== id);
    publish();
  }

  function answer(value: AskAnswer): boolean {
    if (!open.some((frame) => frame.ask.ask_id === value.ask_id)) return false;
    const sent = socket.sendAnswer({ type: "answer", ...value });
    if (sent) remove(value.ask_id);
    else publish();
    return sent;
  }

  surfaces.onAskAnswer(answer);
  const offs = [
    socket.onAsk((frame) => {
      const index = open.findIndex((item) => item.ask.ask_id === frame.ask.ask_id);
      if (index < 0) open.push(frame);
      else open[index] = frame;
      publish();
    }),
    socket.onAskEnd(remove),
    socket.onState((state) => {
      if (state.kind !== "ready") {
        open = [];
        publish();
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
    clearTimeout(timer);
    open = [];
    surfaces.setAsks([]);
  };
}
