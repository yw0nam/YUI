import { spawnSync } from "node:child_process";

type Probe = (command: string) => boolean;

function canLaunchPython3(command: string): boolean {
  const result = spawnSync(
    command,
    ["-c", "import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)"],
    {
      stdio: "ignore",
      timeout: 2_000,
      windowsHide: true,
    },
  );
  return result.error === undefined && result.status === 0;
}

export function resolvePythonCommand(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  probe: Probe = canLaunchPython3,
): string {
  const override = env.YUI_PYTHON?.trim();
  if (override) {
    if (!probe(override)) throw new Error(`YUI_PYTHON override is not usable: ${override}`);
    return override;
  }

  const candidates = platform === "win32" ? ["python", "py"] : ["python3"];
  const command = candidates.find(probe);
  if (!command) {
    throw new Error("Python interpreter not found; install Python or set YUI_PYTHON");
  }
  return command;
}
