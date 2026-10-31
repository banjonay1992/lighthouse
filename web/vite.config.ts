import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// The front end is a small Preact app. It is built into ../dist, which the
// Worker serves as static assets. During `npm run dev:web` API calls are
// proxied to a running `wrangler dev` on port 8787.
export default defineConfig({
  root,
  publicDir: "public",
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
