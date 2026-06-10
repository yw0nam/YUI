#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolvePort, findFreePort, buildDevUrl, tauriConfigArg } from "./dev-port.mjs";

const port = await resolvePort({ env: process.env, isPortFree: findFreePort });
console.log(`[YUI] tauri dev → ${buildDevUrl(port)} (YUI_DEV_PORT=${port})`);
const child = spawn("pnpm", ["exec", "tauri", "dev", "--config", tauriConfigArg(port)], {
  stdio: "inherit",
  env: { ...process.env, YUI_DEV_PORT: String(port) },
});
child.on("exit", (code) => process.exit(code ?? 1));
