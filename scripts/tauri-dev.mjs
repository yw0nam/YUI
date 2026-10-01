#!/usr/bin/env node
import { spawn } from "node:child_process";
import os from "node:os";
import { buildDevUrl, findFreePort, resolvePort, tauriConfigArg } from "./dev-port.mjs";
import { packageManagerCommand, stopProcessTree } from "./package-manager.mjs";

// argv carries the tauri subcommand: `dev`, or `android dev --no-watch`.
const tauriArgs = process.argv.slice(2);
const label = `tauri ${tauriArgs.join(" ")}`;
const port = await resolvePort({ env: process.env, isPortFree: findFreePort });
console.log(`[YUI] ${label} → ${buildDevUrl(port)} (YUI_DEV_PORT=${port})`);
const { command, args, shell } = packageManagerCommand([
  "exec",
  "tauri",
  ...tauriArgs,
  "--config",
  tauriConfigArg(port),
]);
const child = spawn(command, args, {
  stdio: "inherit",
  detached: process.platform !== "win32",
  shell,
  env: { ...process.env, YUI_DEV_PORT: String(port) },
});
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(sig, () => stopProcessTree(child, sig));
child.on("error", (err) => {
  console.error(`[YUI] failed to start ${label}: ${err.message}`);
  process.exit(1);
});
// signal death exits 128+signum (130 for SIGINT), preserving the failure-vs-Ctrl-C distinction.
child.on("exit", (code, signal) =>
  process.exit(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 1) : 0)),
);
