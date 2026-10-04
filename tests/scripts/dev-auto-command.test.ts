import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

import { packageManagerCommand } from "../../scripts/package-manager.mjs";

describe("package manager launcher", () => {
  it("uses a shell only on Windows", () => {
    expect(packageManagerCommand(["exec", "vite"], "win32")).toEqual({
      command: "pnpm",
      args: ['"exec"', '"vite"'],
      shell: true,
    });
    expect(packageManagerCommand(["exec", "vite"], "linux")).toEqual({
      command: "pnpm",
      args: ["exec", "vite"],
      shell: false,
    });
  });

  it("quotes Windows shell metacharacters without changing the value", async () => {
    const value = 'a&b%c^d|e<f>g(h)"i';
    const { command, args, shell } = packageManagerCommand([
      "exec",
      "node",
      "-p",
      "process.argv[1]",
      "--",
      value,
    ]);
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { shell });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)),
      );
    });

    expect(output).toBe(value);
  });

  it("passes the Tauri JSON config value to the child unchanged", async () => {
    const config = JSON.stringify({ build: { devUrl: "http://127.0.0.1:1738" } });
    const { command, args, shell } = packageManagerCommand([
      "exec",
      "node",
      "-p",
      "process.argv[2]",
      "--",
      "--config",
      config,
    ]);
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { shell });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)),
      );
    });

    expect(output).toBe(config);
  });
});
