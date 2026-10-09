import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// QA evidence for plan T3: top-of-page viewport captures at 375px and 1280px.
// JPEG quality 60 keeps the committed set small (< 1.5 MB in total).
// Run: npm run build && QA_SCREENSHOTS=1 npx playwright test --project=screenshots
const OUT = join(process.cwd(), "docs", "qa", "screenshots");
const PAGES: Array<[name: string, route: string]> = [
  ["home", "/"],
  ["products", "/products"],
  ["products-sea", "/products/sea"],
  ["pricing", "/pricing"],
  ["contact", "/contact"],
];
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1280, height: 800 },
];

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

for (const [name, route] of PAGES) {
  for (const viewport of VIEWPORTS) {
    test(`${name} at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: join(OUT, `${name}-${viewport.width}.jpg`),
        type: "jpeg",
        quality: 60,
        fullPage: false,
      });
    });
  }
}
