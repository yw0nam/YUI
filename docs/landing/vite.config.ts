import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/YUI/",
  publicDir: "../public",
  build: {
    copyPublicDir: false,
    outDir: "../.vitepress/dist",
    emptyOutDir: false,
    assetsDir: "landing-assets",
  },
});
