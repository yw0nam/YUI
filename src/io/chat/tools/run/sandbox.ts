export type RunResult =
  | { status: "completed"; result: unknown; logs: string[] }
  | { status: "error"; error: string; logs: string[] };

export type HostApi = { [name: string]: ((...args: unknown[]) => Promise<unknown>) | HostApi };

export interface ScriptHost {
  yui: HostApi;
  help(): string;
}

export interface RunLimits {
  cpuMs?: number;
  memoryBytes?: number;
  stackBytes?: number;
  outputBytes?: number;
}

export async function runScript(
  _code: string,
  _host: ScriptHost,
  _signal: AbortSignal,
  _limits: RunLimits = {},
): Promise<RunResult> {
  return { status: "error", error: "not implemented", logs: [] };
}
