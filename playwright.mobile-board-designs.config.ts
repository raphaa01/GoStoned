import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/mobile", fullyParallel: false, workers: 1, timeout: 45000,
  forbidOnly: Boolean(process.env.CI), retries: process.env.CI ? 1 : 0, failOnFlakyTests: Boolean(process.env.CI),
  reporter: "line", expect: { timeout: 8000 },
  use: { baseURL: "http://127.0.0.1:4175", browserName: "chromium", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "mobile-390-touch", use: { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } } },
    { name: "mobile-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: "node node_modules/vite/bin/vite.js preview --config vite.mobile.config.mts --host 127.0.0.1 --port 4175", url: "http://127.0.0.1:4175", reuseExistingServer: false, timeout: 30000 },
});
