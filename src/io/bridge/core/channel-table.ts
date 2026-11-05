/** channel-table — one entry per cross-window channel; the bridge's emit/on pairs and state mirrors are built from it. */

import type { createBridgeCore, WindowKind } from "./bridge-core";
import { createStateMirror, publishState } from "./state-mirror";

export interface Channel {
  name: string;
  /** "preset": delivered only to windows of the sender's preset. */
  scope: "shared" | "preset";
  /** Calls `deliver` with the callback's arguments, or not at all to drop the payload; without it the callback gets none. */
  read?(payload: unknown, deliver: (...value: unknown[]) => void, from: WindowKind): void;
  /** The wire payload for the emit's arguments; without it the emit sends its one argument, or nothing. */
  encode?(...args: unknown[]): unknown;
  /** The emit returns the send's promise. */
  settled?: true;
  /** The value one window owns and the others mirror; `ask` is the key of the channel that asks for it. */
  mirror?: { ask: string; initial: unknown };
}

type Delivered<C> = C extends {
  read(payload: unknown, deliver: (...value: infer D) => void, from: WindowKind): void;
}
  ? D
  : [];
type EmitArgs<C> = C extends { encode(...args: infer A): unknown } ? A : Delivered<C>;

export type ChannelMethods<T> = {
  [K in keyof T & string as `emit${K}`]: (
    ...args: EmitArgs<T[K]>
  ) => T[K] extends { settled: true } ? Promise<void> : void;
} & {
  [K in keyof T & string as `on${K}`]: (cb: (...value: Delivered<T[K]>) => void) => () => void;
};

export function createChannelMethods<T extends Record<string, Channel>>(
  core: ReturnType<typeof createBridgeCore>,
  table: T,
): ChannelMethods<T> {
  const methods: Record<string, unknown> = {};
  for (const [key, channel] of Object.entries(table)) {
    methods[`emit${key}`] = (...args: unknown[]) => {
      const sent = core.emit(channel.name, channel.encode ? channel.encode(...args) : args[0]);
      return channel.settled ? sent : undefined;
    };
    methods[`on${key}`] = (cb: (...value: unknown[]) => void) =>
      core.on(
        channel.name,
        (payload, from) => (channel.read ? channel.read(payload, cb, from) : cb()),
        { scoped: channel.scope === "preset" },
      );
  }
  // The loop above builds exactly the emit/on pair of every key the table holds.
  return methods as ChannelMethods<T>;
}

type Value<C> = Delivered<C>[0];
type MirroredKey<T> = {
  [K in keyof T]: T[K] extends { mirror: { ask: keyof T; initial: Value<T[K]> } } ? K : never;
}[keyof T] &
  string;
type AskOf<C> = C extends { mirror: { ask: infer A extends string } } ? A : never;

/** Both sides of a mirrored channel: the owner publishes its value, a reader mirrors it. */
export function channelMirror<T extends Record<string, Channel>, K extends MirroredKey<T>>(
  table: T,
  key: K,
  bridge: Pick<
    ChannelMethods<T>,
    `emit${K}` | `on${K}` | `emit${AskOf<T[K]>}` | `on${AskOf<T[K]>}`
  >,
) {
  type V = Value<T[K]>;
  // MirroredKey admits only keys whose entry has a mirror of this shape.
  const { ask, initial } = table[key].mirror as { ask: string; initial: V };
  // The bridge type above lists every method name built here.
  const port = bridge as unknown as Record<string, (...args: never[]) => never>;
  return {
    publish: (source: { get(): V; subscribe(cb: (value: V) => void): () => void }) =>
      publishState({
        get: source.get,
        subscribe: source.subscribe,
        emit: port[`emit${key}`],
        onAsk: port[`on${ask}`],
      }),
    create: () => createStateMirror<V>({ initial, on: port[`on${key}`], ask: port[`emit${ask}`] }),
  };
}
