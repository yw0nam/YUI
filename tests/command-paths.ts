import { join } from "node:path";

export const BASH =
  process.platform !== "win32"
    ? "bash"
    : (process.env.YUI_BASH ??
      join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe"));
