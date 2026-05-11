import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    chunkSizeWarningLimit: 2600,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
