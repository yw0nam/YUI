import { defineConfig, type Plugin } from "vite";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// dev 정적 서빙: /vrms/* → resources/vrms/, /configs/* → configs/.
// VRM 에셋(resources/vrms, gitignore됨)·런타임 config를 publicDir 없이 클린 URL로 노출.
// prod(Tauri)는 asset 프로토콜로 별도 처리 — 추후(#27 패키징).
const MIME: Record<string, string> = {
  ".vrm": "application/octet-stream",
  ".vrma": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
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
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // 같은 출처 /__hermes → Hermes로 프록시 (web chat CORS preflight 회피, SSE 스트리밍).
    // :8643은 configs/endpoints.json chat_base_url과 동기 유지.
    proxy: {
      "/__hermes": {
        target: "http://localhost:8643",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__hermes/, ""),
        // Hermes는 Origin을 allowlist 검사 → 1420 외 워크트리 dev 포트는 403.
        // changeOrigin은 Host만 바꾸므로 Origin을 허용 값으로 덮어써 어떤 포트든 통과시킨다.
        configure: (proxy) => {
          const origin = process.env.YUI_HERMES_ORIGIN ?? "http://localhost:1420";
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("origin", origin));
        },
      },
    },
  },
  plugins: [serveDir("/vrms", "resources/vrms"), serveDir("/configs", "configs"), serveDir("/vad", "public/vad")],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        motionPreview: resolve(__dirname, "motion-preview.html"),
      },
    },
  },
});
