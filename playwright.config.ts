import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.playwright.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4175",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "narrow-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 320, height: 760 },
      },
    },
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 820 },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 4175",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    url: "http://127.0.0.1:4175",
  },
});
