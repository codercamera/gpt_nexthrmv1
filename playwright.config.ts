import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    launchOptions: process.env.CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.CHROMIUM_EXECUTABLE,
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"],
        }
      : undefined,
    trace: "retain-on-failure",
  },
  workers: 1,
  reporter: "list",
  webServer: {
    command: "bun server/index.ts",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
  },
});
