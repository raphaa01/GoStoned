import { defineConfig } from "@playwright/test";

const host = "127.0.0.1";
const port = 3100;
const baseURL = `http://${host}:${port}`;

if (new URL(baseURL).hostname !== host) {
  throw new Error("Responsive browser tests must run against the fixed local server.");
}

export default defineConfig({
  testDir: "./tests/browser",
  expect: { timeout: 8_000 },
  failOnFlakyTests: Boolean(process.env.CI),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "dark",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium-320-touch",
      use: {
        hasTouch: true,
        isMobile: true,
        viewport: { width: 320, height: 720 },
      },
    },
    {
      name: "chromium-390-touch",
      use: {
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "chromium-768",
      use: {
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "chromium-1024",
      use: {
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "chromium-1440",
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: `npm run start -- --hostname ${host} --port ${port}`,
    env: {
      DATABASE_URL: "postgresql://browser-tests:browser-tests@127.0.0.1:1/browser-tests",
      NEXT_PUBLIC_APP_URL: baseURL,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: `${baseURL}/api/health`,
  },
});
