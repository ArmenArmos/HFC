import { defineConfig } from "@playwright/test";

// One worker: the journeys share one app and one database. No retries: a retry-only pass is a flake to fix.
export default defineConfig({
  testDir: "web",
  outputDir: ".state/results",
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["json", { outputFile: ".state/results.json" }]],
  use: { locale: "en-GB", timezoneId: "Asia/Yerevan", screenshot: "on", trace: "retain-on-failure", actionTimeout: 30_000, navigationTimeout: 120_000 },
  // WebKit is a separate run (pnpm e2e:web:webkit): the journeys sign up and change data once per database.
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit" } }, { name: "telegram", testDir: "telegram", use: { browserName: "chromium" } }],
});
