import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { resolveVitePort } from "./scripts/dev-port.mjs";

// Dev static serving: /vrms/* → resources/vrms/, /configs/* → configs/.
// Exposes VRM assets (resources/vrms, gitignored) and runtime config at clean URLs without a publicDir.
// prod (Tauri) serves via bundle.resources + the asset protocol — src/io/asset-url.ts resolves the same logical paths.
const MIME: Record<string, string> = {
  ".vrm": "application/octet-stream",
  ".vrma": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function serveDir(prefix: string, dir: string): Plugin {
  const root = resolve(process.cwd(), dir);
  return {
    name: `yui-serve:${prefix}`,
    configureServer(server) {
      // connect strips the prefix and passes req.url (e.g. /vrms/x.vrm → /x.vrm).
      server.middlewares.use(prefix, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = normalize(resolve(root, `.${rel}`));
        // Block path traversal + real files only.
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
          return next();
        }
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Dev port is YUI_DEV_PORT (when set) else 1420, with strictPort failing fast on conflict —
// the launcher (scripts/*.mjs) picks a free port and syncs it with tauri.conf.json devUrl.
// clearScreen: false → keeps tauri CLI logs from being hidden by vite logs.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(() => ({
  clearScreen: false,
  server: {
    port: resolveVitePort(),
    strictPort: true,
    host: "127.0.0.1",
    // Same-origin /__hermes → proxy to Hermes (avoids web chat CORS preflight, SSE streaming).
    // :8643 stays in sync with chat_base_url in configs/endpoints.json.
    proxy: {
      "/__hermes": {
        target: "http://localhost:8643",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__hermes/, ""),
        // Hermes allowlist-checks the Origin → worktree dev ports other than 1420 get 403.
        // changeOrigin only changes Host, so overwrite Origin with an allowed value to let any port through.
        configure: (proxy) => {
          const origin = process.env.YUI_HERMES_ORIGIN ?? "http://localhost:1420";
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("origin", origin));
        },
      },
    },
  },
  plugins: [
    serveDir("/vrms", "resources/vrms"),
    serveDir("/references", "resources/references"),
    serveDir("/configs", "configs"),
    serveDir("/vad", "public/vad"),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        settings: resolve(__dirname, "settings.html"),
        devtools: resolve(__dirname, "devtools.html"),
      },
    },
  },
}));
