import { defineConfig, devices } from "@playwright/test";

// Headless Firefox ships with WebGL disabled; the viewer journey needs it.
const firefox = { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true, "webgl.disabled": false } } };

// Journeys run in Chromium; tests tagged @firefox run in Firefox too and @webkit in desktop WebKit. The phone
// projects run journeys tagged @phone, plus @android (phone-chromium) or @ios (phone-webkit); @mobile-only keeps
// a phone-shell journey out of the desktop Chromium project, and @no-chromium keeps out a desktop journey that
// desktop Chromium never reaches (AC-08 share sheet cases). E2E_SKIP_WEBKIT=1 leaves both WebKit projects out
// on a host without WebKit's libraries (scripts/verify.sh reports it); CI never sets it. The WebKit projects
// block service workers so the sign-in cookie fixture in fixtures.ts can see the page's requests. Sign-in scenarios use
// the failure budget on purpose, so they have their own projects and their own container (see signin.spec.ts).
const skipWebkit = process.env.E2E_SKIP_WEBKIT === "1";
const SIGNIN = "**/signin.spec.ts";

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
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: SIGNIN, grepInvert: /@mobile-only|@no-chromium/ },
    { name: "firefox", use: firefox, grep: /@firefox/, testIgnore: SIGNIN },
    ...(skipWebkit ? [] : [{ name: "webkit-desktop", use: { ...devices["Desktop Safari"], serviceWorkers: "block" as const }, grep: /@webkit/, testIgnore: SIGNIN }]),
    { name: "phone-chromium", use: { ...devices["Pixel 7"] }, grep: /@phone|@android/, testIgnore: SIGNIN },
    ...(skipWebkit ? [] : [{ name: "phone-webkit", use: { ...devices["iPhone 15"], serviceWorkers: "block" as const }, grep: /@phone|@ios/, testIgnore: SIGNIN }]),
    { name: "signin-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: SIGNIN },
    { name: "signin-firefox", use: firefox, testMatch: SIGNIN },
  ],
});
