import { createServer } from "node:net";

// 워크트리별 dev 포트 해석: YUI_DEV_PORT(설정 시) 우선, 아니면 base부터 빈 포트 스캔.
// 순수 로직(resolvePort/isValidPort/buildDevUrl/tauriConfigArg)과 실제 소켓 프로브
// (findFreePort)를 분리 — 프로브는 런타임에 resolvePort로 주입, 테스트는 fake를 넣는다.

export function isValidPort(n) {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function buildDevUrl(port) {
  // 127.0.0.1 고정: vite host와 일치, Tauri dev-server 대기에서 localhost→IPv6 ::1 stall 회피.
  return `http://127.0.0.1:${port}`;
}

export function tauriConfigArg(port) {
  return JSON.stringify({ build: { devUrl: buildDevUrl(port) } });
}

export function resolveVitePort(env = process.env) {
  const requested = env.YUI_DEV_PORT;
  if (requested === undefined || requested === "") return 1420;
  const n = Number(requested);
  if (isValidPort(n)) return n;
  throw new Error(`Invalid YUI_DEV_PORT: ${requested} (expected integer 1..65535)`);
}

export async function resolvePort({ env, isPortFree, base = 1420, maxScan = 100 }) {
  const requested = env.YUI_DEV_PORT;
  if (requested !== undefined && requested !== "") {
    const n = Number(requested);
    if (isValidPort(n)) return n;
    throw new Error(`Invalid YUI_DEV_PORT: ${requested} (expected integer 1..65535)`);
  }
  for (let port = base; port < base + maxScan; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free dev port in range ${base}..${base + maxScan - 1}`);
}

// Best-effort probe; strictPort is the real arbiter — a lost probe-vs-bind race fails loudly.
// IPv4 127.0.0.1-scoped: a holder on 0.0.0.0/:: reads free here, then strictPort backstops the bind.
export async function findFreePort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen({ port, host: "127.0.0.1" });
  });
}
