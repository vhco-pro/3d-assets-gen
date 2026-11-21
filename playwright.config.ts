import { defineConfig, devices } from "@playwright/test";

// Headless Firefox ships with WebGL disabled; the viewer journey needs it.
const firefox = { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true, "webgl.disabled": false } } };

// Journeys run in Chromium; tests tagged @firefox run in Firefox too. Sign-in scenarios use the failure
// budget on purpose, so they have their own projects and their own container (see signin.spec.ts).
export default defineConfig({
  testDir: "app/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: ".artifacts/playwright",
  globalSetup: "./app/e2e/global.ts",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 2,
  reporter: [["list"], ["html", { open: "never", outputFolder: ".artifacts/playwright-report" }]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/signin.spec.ts" },
    { name: "firefox", use: firefox, grep: /@firefox/, testIgnore: "**/signin.spec.ts" },
    { name: "signin-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: "**/signin.spec.ts" },
    { name: "signin-firefox", use: firefox, testMatch: "**/signin.spec.ts" },
  ],
});
