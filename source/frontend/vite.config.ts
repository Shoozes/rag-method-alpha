import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const backendTarget = env.VITE_BACKEND_URL || "http://127.0.0.1:8080";

  return {
    plugins: [react()],
    cacheDir: "../../.artifacts/vite-cache-lab",
    server: {
      port: 5173,
      proxy: {
        "/api": backendTarget,
        "/rag": backendTarget,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            "three-vendor": ["three"],
            "graph-vendor": ["react-force-graph-3d"],
          },
        },
      },
    },
  };
});
