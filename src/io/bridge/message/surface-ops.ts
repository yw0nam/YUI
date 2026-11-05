/**
 * Each pet → message surface op once: the `RemoteSurfaces` call that sends it, its payload, the call
 * that draws it in the message window, and whether `ready` replays it. The key order is the replay
 * order; a bubble op draws the speech bubble and its quoted turn.
 */

import type { MessageControlOp } from "./message-bridge";
import type { RemoteSurfaces } from "./message-remote";

type Control = (op: MessageControlOp) => void;

interface Flags<P> {
  /** `ready` sends the last payload again, or `initial` before any call. */
  replay?: true;
  initial?: P;
  bubble?: true;
}

function entry<M extends keyof RemoteSurfaces, P extends object, const F extends Flags<P>>(
  method: M,
  encode: (...args: Parameters<RemoteSurfaces[M]>) => P,
  receive: (payload: P, port: Pick<RemoteSurfaces, M>, control: Control) => void,
  flags = {} as F,
) {
  return { method, encode, receive, ...flags };
}

export const surfaceOps = {
  asks: entry(
    "setAsks",
    (frames) => ({ frames }),
    (p, s) => s.setAsks(p.frames),
    { replay: true },
  ),
  commands: entry(
    "setCommands",
    (commands) => ({ commands }),
    (p, s) => s.setCommands(p.commands),
    { replay: true },
  ),
  "command-reply": entry(
    "showCommandReply",
    (reply) => ({ reply }),
    (p, s) => s.showCommandReply(p.reply),
    { replay: true },
  ),
  "attachment-limits": entry(
    "setAttachmentLimits",
    (limits) => ({ limits }),
    (p, s) => s.setAttachmentLimits(p.limits),
    { replay: true },
  ),
  name: entry(
    "setName",
    (name) => ({ name }),
    (p, s) => s.setName(p.name),
    { replay: true },
  ),
  busy: entry(
    "setBusy",
    (busy) => ({ busy }),
    (p, s) => s.setBusy(p.busy),
    {
      replay: true,
      initial: { busy: false },
    },
  ),
  begin: entry(
    "beginSpeech",
    () => ({}),
    (_, s) => s.beginSpeech(),
    { bubble: true },
  ),
  push: entry(
    "pushSpeech",
    (delta) => ({ delta }),
    (p, s) => s.pushSpeech(p.delta),
    {
      bubble: true,
    },
  ),
  end: entry(
    "endSpeech",
    (opts) => (opts?.defer ? { defer: true } : {}),
    (p, s) => s.endSpeech(p.defer ? { defer: true } : undefined),
    { bubble: true },
  ),
  finish: entry(
    "finishSpeech",
    () => ({}),
    (_, s) => s.finishSpeech(),
    { bubble: true },
  ),
  hide: entry(
    "hideSpeech",
    () => ({}),
    (_, s) => s.hideSpeech(),
    { bubble: true },
  ),
  quote: entry(
    "quoteUser",
    (quote) => ({ quote }),
    (p, s) => s.quoteUser(p.quote),
    {
      bubble: true,
    },
  ),
  "quote-signals": entry(
    "quoteSignals",
    (lines) => ({ lines }),
    (p, s) => s.quoteSignals(p.lines),
    { bubble: true },
  ),
  "settle-quote": entry(
    "settleQuote",
    () => ({}),
    (_, s) => s.settleQuote(),
    { bubble: true },
  ),
  "clear-quote": entry(
    "clearQuote",
    () => ({}),
    (_, s) => s.clearQuote(),
    { bubble: true },
  ),
  "summon-input": entry(
    "summonInput",
    () => ({}),
    (_, s) => s.summonInput(),
  ),
  "dismiss-input": entry(
    "dismissInput",
    () => ({}),
    (_, s) => s.dismissInput(),
  ),
  "input-error": entry(
    "showInputError",
    (message, action) => (action ? { message, action: { label: action.label } } : { message }),
    (p, s, control) =>
      s.showInputError(
        p.message,
        p.action
          ? { label: p.action.label, onClick: () => control({ op: "input-error-action" }) }
          : undefined,
      ),
  ),
  "speech-actions": entry(
    "showSpeechActions",
    (actions) => ({
      actions: actions.map(({ label, busy }) => (busy ? { label, busy } : { label })),
    }),
    (p, s, control) =>
      s.showSpeechActions(
        p.actions.map(({ label, busy }, index) => ({
          label,
          busy,
          onClick: () => control({ op: "speech-action", index }),
        })),
      ),
  ),
  "restore-input": entry(
    "restoreInput",
    (text, images) => ({ text, images }),
    (p, s) => s.restoreInput(p.text, p.images),
  ),
};

type Table = typeof surfaceOps;
type OpName = keyof Table;

/** Pet → message: one call on the message window's local `Surfaces`. */
export type MessageSurfaceOp = {
  [K in OpName]: { op: K } & ReturnType<Table[K]["encode"]>;
}[OpName];

/** The calls the message window makes to draw the named ops. */
export type SurfacePort<K extends OpName = OpName> = Pick<RemoteSurfaces, Table[K]["method"]>;

interface AnyEntry {
  method: Table[OpName]["method"];
  encode(...args: unknown[]): object;
  receive(payload: unknown, port: SurfacePort, control: Control): void;
  replay?: true;
  initial?: object;
}

// The entries' payload types differ, so the code that iterates the table casts to one shape.
const entries = Object.entries(surfaceOps) as unknown as [OpName, AnyEntry][];

/** Draws one op on the port; false when the op names no entry. */
export function receiveSurfaceOp<O extends MessageSurfaceOp>(
  op: O,
  port: SurfacePort<O["op"]>,
  control: Control,
): boolean {
  if (!Object.hasOwn(surfaceOps, op.op)) return false;
  // The port holds the method of the op's own entry, the only one its receive calls.
  (surfaceOps[op.op] as unknown as AnyEntry).receive(op, port as SurfacePort, control);
  return true;
}

/** The `RemoteSurfaces` calls that send each op, and `replay` for a message window that comes up later. */
export function createSurfaceSender(emit: (op: MessageSurfaceOp) => void) {
  const held = new Map<OpName, MessageSurfaceOp>();
  const send = (op: OpName, e: AnyEntry, payload: object): MessageSurfaceOp => {
    const sent = { op, ...payload } as MessageSurfaceOp;
    if (e.replay) held.set(op, sent);
    return sent;
  };
  for (const [op, e] of entries) if (e.initial) send(op, e, e.initial);
  const methods = Object.fromEntries(
    entries.map(([op, e]) => [
      e.method,
      (...args: unknown[]) => emit(send(op, e, e.encode(...args))),
    ]),
  ) as unknown as SurfacePort;
  return {
    methods,
    replay(): void {
      for (const [op] of entries) {
        const sent = held.get(op);
        if (sent) emit(sent);
      }
    },
  };
}
