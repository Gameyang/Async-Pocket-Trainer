import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2600,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
