import { defineConfig, type Plugin } from "vite";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, normalize, resolve } from "node:path";

// dev 정적 서빙: /vrms/* → resources/vrms/, /configs/* → configs/.
// VRM 에셋(resources/vrms, gitignore됨)·런타임 config를 publicDir 없이 클린 URL로 노출.
// prod(Tauri)는 asset 프로토콜로 별도 처리 — 추후(#27 패키징).
const MIME: Record<string, string> = {
  ".vrm": "application/octet-stream",
  ".vrma": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".json": "application/json",
};

function serveDir(prefix: string, dir: string): Plugin {
  const root = resolve(process.cwd(), dir);
  return {
    name: `yui-serve:${prefix}`,
    configureServer(server) {
      // connect가 prefix를 벗겨 req.url을 넘긴다 (예: /vrms/x.vrm → /x.vrm).
      server.middlewares.use(prefix, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = normalize(resolve(root, "." + rel));
        // path traversal 차단 + 실제 파일만.
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Tauri 규약: dev server는 고정 포트 1420 (tauri.conf.json devUrl과 일치).
// clearScreen: false → tauri CLI 로그가 vite 로그에 가려지지 않게.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  plugins: [serveDir("/vrms", "resources/vrms"), serveDir("/configs", "configs")],
});
