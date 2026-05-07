import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        main:               resolve(__dirname, "index.html"),
        maritimeAnalytics:  resolve(__dirname, "maritime/analytics/index.html"),
        adminLive:          resolve(__dirname, "admin/live.html"),
        adminAudit:         resolve(__dirname, "admin/audit.html"),
        adminStatus:        resolve(__dirname, "admin/status.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});
