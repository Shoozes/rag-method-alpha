import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = fileURLToPath(new URL(".", import.meta.url));

const config = {
  base: "./",
  root: resolve(moduleRoot, "demo"),
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: {
      strict: true,
      deny: [".env", ".env.*", "*.{crt,pem,key,p12,pfx}", "**/.git/**", "**/.npmrc", "**/.yarnrc*", "**/.secrets/**"],
      allow: [moduleRoot],
    },
  },
  build: {
    outDir: resolve(moduleRoot, ".artifacts", "dist"),
    emptyOutDir: true,
    // Three/WebGPU is an explicit optional graph chunk; the task UI remains
    // small and loads before this adapter. Warn only if that isolated boundary grows.
    chunkSizeWarningLimit: 1_350,
    rollupOptions: {
      input: {
        landing: resolve(moduleRoot, "demo", "index.html"),
        browser: resolve(moduleRoot, "demo", "browser", "index.html"),
      },
    },
  },
};

export default config;
