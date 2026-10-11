import { defineConfig } from "@playwright/test";

// The PostgreSQL smoke supervisor supplies the production server and cleans it up.
export default defineConfig({
  testDir: "./tests/authenticated", workers: 1, timeout: 45000,
  forbidOnly: Boolean(process.env.CI), retries: process.env.CI ? 1 : 0, failOnFlakyTests: Boolean(process.env.CI),
  reporter: "line", expect: { timeout: 8000 },
  use: { baseURL: "http://127.0.0.1:3101", browserName: "chromium", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "review-390-touch", use: { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } } },
    { name: "review-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
