#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolvePort, findFreePort, buildDevUrl } from "./dev-port.mjs";

const port = await resolvePort({ env: process.env, isPortFree: findFreePort });
console.log(`[YUI] vite dev → ${buildDevUrl(port)} (browser only, YUI_DEV_PORT=${port})`);
const child = spawn("pnpm", ["exec", "vite"], {
  stdio: "inherit",
  env: { ...process.env, YUI_DEV_PORT: String(port) },
});
child.on("exit", (code) => process.exit(code ?? 1));
