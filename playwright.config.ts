import { defineConfig, devices } from "@playwright/test";

// Runs against the built site (`npm run build` first) served by `astro preview`.
// A dedicated port (not Astro's default 4321) and reuseExistingServer: false so
// the suite never silently tests some other dev server already on 4321.
const PORT = Number(process.env.E2E_PORT ?? 4329);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@device/,
      testIgnore: "**/screenshots.spec.ts",
    },
    // A real mobile descriptor (touch, mobile UA, DPR 2.625, 412px viewport):
    // layout, header and overlay tests tagged @mobile, plus @device tests that
    // run at the device's own viewport.
    {
      name: "pixel-7",
      use: { ...devices["Pixel 7"] },
      grep: /@mobile|@device/,
      testIgnore: "**/screenshots.spec.ts",
    },
    // QA evidence (plan T3): QA_SCREENSHOTS=1 npx playwright test --project=screenshots
    // writes docs/qa/screenshots/*.jpg. Off by default so e2e runs never rewrite them.
    ...(process.env.QA_SCREENSHOTS
      ? [
          {
            name: "screenshots",
            use: { ...devices["Desktop Chrome"] },
            testMatch: "**/screenshots.spec.ts",
          },
        ]
      : []),
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
