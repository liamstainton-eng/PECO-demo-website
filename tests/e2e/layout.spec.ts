import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Every built page, read from dist/ (run `npm run build` first).
const DIST = join(process.cwd(), "dist");
function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return full.endsWith(".html") ? [full] : [];
  });
}
const routes = htmlFiles(DIST)
  .map((f) => "/" + relative(DIST, f).split(sep).join("/"))
  .map(
    (p) => p.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "") || "/",
  )
  .sort();

test("dist contains pages", () => {
  expect(routes.length).toBeGreaterThan(0);
});

for (const route of routes) {
  test.describe(`page ${route}`, () => {
    test("no horizontal scroll at 320px", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(route);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });

    for (const width of [1280, 320]) {
      test(`axe: no serious or critical violations at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        const bad = results.violations.filter(
          (v) => v.impact === "serious" || v.impact === "critical",
        );
        expect(
          bad.map(
            (v) =>
              `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
          ),
        ).toEqual([]);
      });
    }

    test("Tab reaches the skip link first", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(route);
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      await expect(focused).toHaveAttribute("href", "#main");
      await expect(focused).toBeVisible();
    });
  });
}

test.describe("header interactions", () => {
  test("Products disclosure opens with Enter and closes with Escape, returning focus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const button = page.locator('button[aria-controls="products-panel"]');
    const panel = page.locator("#products-panel");

    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();

    // Keyboard only: tab until the Products button has focus.
    for (
      let i = 0;
      i < 10 && !(await button.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(button).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();

    // Move into the panel, then Escape closes and returns focus to the button.
    await page.keyboard.press("Tab");
    await expect(panel.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("Products disclosure closes when focus leaves it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const button = page.locator('button[aria-controls="products-panel"]');
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page
      .locator('#site-header nav[aria-label="Main"] a[href="/about"]')
      .focus();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#products-panel")).toBeHidden();
  });

  test("mobile menu toggles aria-expanded", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const menu = page.locator("#mobile-menu-button");
    const nav = page.locator("#mobile-nav");

    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();

    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(nav).toBeVisible();
    // The panel must actually cover the viewport, not collapse inside the header.
    await expect(
      nav.getByRole("link", { name: "Contact", exact: true }),
    ).toBeInViewport();
    const navBox = await nav.boundingBox();
    expect(navBox?.height ?? 0).toBeGreaterThan(400);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  test("mobile CTA bar does not hide the last focusable element", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const bar = page.locator('nav[aria-label="Quick contact"]');
    await expect(bar).toBeVisible();
    const lastFooterLink = page.locator("footer a").last();
    await lastFooterLink.focus();
    const linkBox = await lastFooterLink.boundingBox();
    const barBox = await bar.boundingBox();
    expect(
      linkBox && barBox && linkBox.y + linkBox.height <= barBox.y,
    ).toBeTruthy();
  });
});
