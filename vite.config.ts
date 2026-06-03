import { defineConfig } from "vite";

// Tauri 규약: dev server는 고정 포트 1420 (tauri.conf.json devUrl과 일치).
// clearScreen: false → tauri CLI 로그가 vite 로그에 가려지지 않게.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
});
