/** yui.terminal: the backend's side of the shared terminals, over the terminal commands. */

export type TerminalInvoke = (command: string, args?: Record<string, unknown>) => Promise<string>;

export const TERMINAL_DECLARATION = "";

export function createTerminalApi(_deps: {
  presetId: () => string | null;
  invoke: TerminalInvoke;
}) {
  const stub = async (): Promise<string> => "";
  return {
    methods: { open: stub, list: stub, read: stub, write: stub, close: stub },
    declaration: TERMINAL_DECLARATION,
  };
}
