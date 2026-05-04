import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        main:     resolve(__dirname, "index.html"),
        analysis: resolve(__dirname, "analysis/index.html"),
        audit:    resolve(__dirname, "audit.html"),
        live:     resolve(__dirname, "live.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});
