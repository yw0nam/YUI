/** yui.plugins: the enabled plugins' tools and skills. */

import type { McpHost } from "../../../mcp-host/mcp-host";

type Method = (signal: AbortSignal, ...args: unknown[]) => Promise<unknown>;

// Scaffolding: the real module replaces it in the next commit.
export function createPluginsApi(_deps: { host: McpHost; presetId: () => string }) {
  const methods: { list: Method; describe: Method; call: Method } = {
    list: async () => undefined,
    describe: async () => undefined,
    call: async () => undefined,
  };
  return {
    methods,
    declaration: "",
    skill: async (_name: string): Promise<string> => "",
    listing: (): string => "",
  };
}
