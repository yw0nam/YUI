/** The shape every yui namespace module gives yui_run. */

/** A namespace method: the run's signal first, then the script's arguments. */
export type YuiMethod = (signal: AbortSignal, ...args: unknown[]) => Promise<unknown>;

/** One yui namespace: its methods and its help() block, without a trailing newline. */
export type YuiNamespace = { methods: Record<string, YuiMethod>; declaration: string };

/** yui.plugins, which also reads a plugin skill for help() and lists the plugins for the description. */
export type PluginsNamespace = YuiNamespace & {
  skill(name: string): Promise<string>;
  listing(): string;
};
