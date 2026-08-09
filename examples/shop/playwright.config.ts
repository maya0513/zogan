import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-no-js", use: { ...devices["Desktop Chrome"], javaScriptEnabled: false } },
  ],
  webServer: {
    command: "vp run db:setup && vp run dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/products",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
