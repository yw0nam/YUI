#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolvePort, findFreePort, buildDevUrl } from "./dev-port.mjs";

const port = await resolvePort({ env: process.env, isPortFree: findFreePort });
console.log(`[YUI] vite dev → ${buildDevUrl(port)} (browser only, YUI_DEV_PORT=${port})`);
const child = spawn("pnpm", ["exec", "vite"], {
  stdio: "inherit",
  detached: true,
  env: { ...process.env, YUI_DEV_PORT: String(port) },
});
// detached → signal the whole process group so grandchild vite is reaped too, not just pnpm.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(sig, () => {
    try {
      process.kill(-child.pid, sig);
    } catch {
      child.kill(sig);
    }
  });
child.on("error", (err) => {
  console.error(`[YUI] failed to start vite dev: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
