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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run preview -- --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
