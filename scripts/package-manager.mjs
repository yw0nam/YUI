import { spawn } from "node:child_process";

function quoteWindowsShellArg(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

export function packageManagerCommand(args, platform = process.platform) {
  const isWindows = platform === "win32";
  return {
    command: "pnpm",
    args: isWindows ? args.map(quoteWindowsShellArg) : args,
    shell: isWindows,
  };
}

export function stopProcessTree(child, signal, platform = process.platform) {
  if (platform === "win32") {
    if (child.pid === undefined) return;
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
