import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Tags (see playwright.config.ts):
// - @mobile: also runs in the real mobile device project (Pixel 7: touch, mobile UA, DPR 2.625).
// - @device: runs only in the mobile device project, at the device's own viewport.

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

// WCAG 2.0-2.2 A/AA rules plus axe best practices (landmarks, heading order, ...).
const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

/** Every axe violation, whatever its impact (minor and moderate included). */
async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

/** Pixels the document is wider than the viewport (0 = no horizontal scroll). */
const horizontalOverflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

// The header bar (logo, phone, quote, menu toggle), not the mobile nav panel.
const headerBar = (page: Page) => page.locator("#site-header > div").first();
const headerTel = (page: Page) =>
  headerBar(page).locator('a[href^="tel:"]').filter({ visible: true });
const headerQuote = (page: Page) =>
  headerBar(page).getByRole("link", { name: "Get a quote", exact: true });

async function expectHeaderActionsVisible(page: Page) {
  await expect(headerTel(page)).toHaveCount(1);
  await expect(headerTel(page)).toBeVisible();
  await expect(headerTel(page)).toBeInViewport();
  await expect(headerQuote(page)).toBeVisible();
  await expect(headerQuote(page)).toBeInViewport();
}

/** A stable fingerprint of the focused element, for comparing Tab stops. */
async function focusedId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "body";
    return `${el.tagName.toLowerCase()}|${el.id}|${el.getAttribute("href") ?? ""}|${(el.textContent ?? "").trim()}`;
  });
}

// WCAG 1.4.12 Text Spacing: the minimum overrides content must survive.
const TEXT_SPACING_CSS = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-bottom: 2em !important; }
`;
const SPACING_PAGES = ["/", "/products/sea", "/pricing"];

test("dist contains pages", () => {
  expect(routes.length).toBeGreaterThan(0);
});

for (const route of routes) {
  test.describe(`page ${route}`, () => {
    test(
      "no horizontal scroll at 320px",
      { tag: "@mobile" },
      async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await page.goto(route);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      },
    );

    for (const width of [1280, 320]) {
      test(`axe: no violations of any impact at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        expect(await axeViolations(page)).toEqual([]);
      });
    }

    for (const width of [375, 1280]) {
      test(
        `header phone and quote links are visible at ${width}px`,
        width === 375 ? { tag: "@mobile" } : {},
        async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(route);
          await expectHeaderActionsVisible(page);
        },
      );
    }

    test(
      "device viewport: no horizontal scroll, header actions visible",
      {
        tag: "@device",
      },
      async ({ page }) => {
        await page.goto(route);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        await expectHeaderActionsVisible(page);
      },
    );

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

test.describe("text spacing (WCAG 1.4.12)", () => {
  for (const route of SPACING_PAGES) {
    for (const width of [320, 1280]) {
      test(`${route} at ${width}px: no horizontal scroll, header quote link visible`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route);
        await page.addStyleTag({ content: TEXT_SPACING_CSS });
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        await expect(headerQuote(page)).toBeVisible();
        await expect(headerQuote(page)).toBeInViewport();
        await expect(headerTel(page)).toBeVisible();
      });
    }
  }
});

test.describe("200% zoom (1280px at 2x: 640px CSS viewport, deviceScaleFactor 2)", () => {
  test.use({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
  for (const route of SPACING_PAGES) {
    test(`${route}: no horizontal scroll, header actions and menu reachable`, async ({
      page,
    }) => {
      await page.goto(route);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await expectHeaderActionsVisible(page);
      await expect(page.locator("#mobile-menu-button")).toBeVisible();
    });
  }
});

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

  test(
    "mobile CTA bar does not hide the last focusable element",
    {
      tag: "@mobile",
    },
    async ({ page }) => {
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
    },
  );
});

test.describe("mobile menu (modal overlay)", { tag: "@mobile" }, () => {
  const menuButton = (page: Page) => page.locator("#mobile-menu-button");
  const panel = (page: Page) => page.locator("#mobile-nav");
  const panelItems = (page: Page) =>
    panel(page).locator("a[href], button:not([disabled])");

  async function openMenu(page: Page, width = 375) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/");
    await menuButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page)).toBeVisible();
  }

  /** Inert state of everything outside the header (skip link, main, footer, CTA bar). */
  const outsideInert = (page: Page) =>
    page.evaluate(() =>
      Array.from(document.body.children)
        .filter((el) => el.id !== "site-header" && el.tagName !== "SCRIPT")
        .map((el) => (el as HTMLElement).inert),
    );

  test("toggles aria-expanded and covers the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(menuButton(page)).toBeVisible();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();

    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect(panel(page)).toBeVisible();
    // The panel must actually cover the viewport, not collapse inside the header.
    await expect(
      panel(page).getByRole("link", { name: "Contact", exact: true }),
    ).toBeInViewport();
    const navBox = await panel(page).boundingBox();
    expect(navBox?.height ?? 0).toBeGreaterThan(400);

    await menuButton(page).click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
  });

  test("opening moves focus to the first control in the panel", async ({
    page,
  }) => {
    await openMenu(page);
    await expect(panelItems(page).first()).toBeFocused();
  });

  test("Tab from the last item wraps to the toggle, then into the panel", async ({
    page,
  }) => {
    await openMenu(page);
    // Reach the last item by keyboard: first item -> Shift+Tab (toggle) -> Shift+Tab (last).
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(panelItems(page).last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(menuButton(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panelItems(page).first()).toBeFocused();
  });

  test("Shift+Tab from the first item stays inside (moves to the toggle)", async ({
    page,
  }) => {
    await openMenu(page);
    await expect(panelItems(page).first()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(menuButton(page)).toBeFocused();
  });

  test("a full Tab cycle never leaves the toggle and panel", async ({
    page,
  }) => {
    await openMenu(page);
    const stops = (await panelItems(page).count()) + 1;
    const allowed = new Set<string>();
    await menuButton(page).focus();
    allowed.add(await focusedId(page));
    for (let i = 0; i < stops - 1; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () =>
          !!document.activeElement &&
          document
            .getElementById("mobile-nav")!
            .contains(document.activeElement),
      );
      expect(inside).toBe(true);
      allowed.add(await focusedId(page));
    }
    // Two more full cycles, both directions: every stop is one already seen.
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < stops * 2; i++) {
        await page.keyboard.press(key);
        expect(allowed.has(await focusedId(page))).toBe(true);
      }
    }
  });

  test("main, footer, CTA bar and skip link are inert while open", async ({
    page,
  }) => {
    await openMenu(page);
    expect(
      await page.locator("main").evaluate((el) => (el as HTMLElement).inert),
    ).toBe(true);
    expect(
      await page.locator("footer").evaluate((el) => (el as HTMLElement).inert),
    ).toBe(true);
    expect(
      await page
        .locator('nav[aria-label="Quick contact"]')
        .evaluate((el) => (el as HTMLElement).inert),
    ).toBe(true);
    expect(
      await page
        .locator(".skip-link")
        .evaluate((el) => (el as HTMLElement).inert),
    ).toBe(true);
    expect(await outsideInert(page)).not.toContain(false);
    // Programmatic focus into inert content is refused.
    await page.locator("main a").first().focus();
    await expect(page.locator("main a").first()).not.toBeFocused();
  });

  test("Escape closes, restores focus to the toggle, removes inert and restores scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    // Focus first: focusing a sticky-header control scrolls the page itself
    // (html scroll-padding-top), which is browser behaviour, not the menu's.
    await menuButton(page).focus();
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForFunction(() => window.scrollY === 600);
    await page.keyboard.press("Enter");
    await expect(panelItems(page).first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    expect(await outsideInert(page)).not.toContain(true);
    await expect(page.locator("html")).not.toHaveClass(/overflow-hidden/);
    expect(await page.evaluate(() => window.scrollY)).toBe(600);
  });

  test("activating a link closes the menu and restores focus", async ({
    page,
  }) => {
    await openMenu(page);
    // Keep the page in place so the post-close state can be checked.
    await page.evaluate(() =>
      document.addEventListener("click", (e) => e.preventDefault()),
    );
    await panel(page)
      .getByRole("link", { name: "Contact", exact: true })
      .click();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    expect(await outsideInert(page)).not.toContain(true);
  });

  test("widening to desktop closes the menu and removes inert", async ({
    page,
  }) => {
    await openMenu(page);
    await page.setViewportSize({ width: 1280, height: 812 });
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
    expect(await outsideInert(page)).not.toContain(true);
    await expect(page.locator("html")).not.toHaveClass(/overflow-hidden/);
  });

  test("open at 320px: no horizontal scroll, every control reachable", async ({
    page,
  }) => {
    await openMenu(page, 320);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const count = await panelItems(page).count();
    for (let i = 0; i < count; i++) {
      const item = panelItems(page).nth(i);
      await expect(item).toBeFocused();
      await expect(item).toBeInViewport();
      const box = (await item.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      await page.keyboard.press("Tab");
    }
    await expect(menuButton(page)).toBeFocused();
    await expect(menuButton(page)).toBeInViewport();
  });

  test("axe: no violations with the menu open", async ({ page }) => {
    await openMenu(page);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("projects lightbox", { tag: "@mobile" }, () => {
  const dialog = (page: Page) => page.locator("dialog[data-gallery-dialog]");
  const dialogImg = (page: Page) => dialog(page).locator("[data-gallery-img]");
  const status = (page: Page) => dialog(page).locator("[data-gallery-status]");
  const thumbs = (page: Page) =>
    page.locator("[data-gallery] button[aria-haspopup='dialog']");

  async function openFirst(page: Page, width = 1280) {
    await page.setViewportSize({ width, height: width < 400 ? 640 : 900 });
    await page.goto("/projects");
    await thumbs(page).first().click();
    await expect(dialog(page)).toBeVisible();
  }

  test("opens with the photo's alt text and a described dialog, nothing announced yet", async ({
    page,
  }) => {
    await openFirst(page);
    const alt0 = await thumbs(page).nth(0).locator("img").getAttribute("alt");
    expect(alt0).toBeTruthy();
    await expect(dialog(page)).toHaveAttribute("aria-label", "Photo viewer");
    await expect(dialog(page)).toHaveAttribute(
      "aria-describedby",
      "gallery-caption",
    );
    await expect(dialog(page)).toHaveAccessibleDescription(alt0!);
    await expect(dialogImg(page)).toHaveAttribute("alt", alt0!);
    await expect(page.locator("#gallery-caption")).toHaveText(alt0!);
    // The caption repeats the alt: hidden from AT so it is not read twice.
    await expect(page.locator("#gallery-caption")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(status(page)).toHaveAttribute("aria-live", "polite");
    await expect(status(page)).toHaveText("");
    // Only one live region in the dialog.
    await expect(dialog(page).locator("[aria-live]")).toHaveCount(1);
    await expect(dialog(page).locator(":focus")).toHaveCount(1);
  });

  test("the closed dialog's image already has the first photo's real src and alt", async ({
    page,
  }) => {
    await page.goto("/projects");
    const alt0 = await thumbs(page).nth(0).locator("img").getAttribute("alt");
    await expect(dialogImg(page)).toHaveAttribute("alt", alt0!);
    await expect(dialogImg(page)).toHaveAttribute(
      "src",
      /\.(webp|jpe?g|png|avif)$/,
    );
  });

  test("navigation updates the alt and announces 'Photo n of N: alt' once", async ({
    page,
  }) => {
    await openFirst(page);
    const total = await thumbs(page).count();
    const alts = await thumbs(page)
      .locator("img")
      .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("alt") ?? ""));

    await dialog(page).getByRole("button", { name: "Next photo" }).click();
    await expect(dialogImg(page)).toHaveAttribute("alt", alts[1]);
    await expect(status(page)).toHaveText(`Photo 2 of ${total}: ${alts[1]}`);
    await expect(dialog(page)).toHaveAccessibleDescription(alts[1]);

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(dialogImg(page)).toHaveAttribute("alt", alts[total - 1]);
    await expect(status(page)).toHaveText(
      `Photo ${total} of ${total}: ${alts[total - 1]}`,
    );

    await page.keyboard.press("ArrowRight");
    await expect(dialogImg(page)).toHaveAttribute("alt", alts[0]);
    await expect(status(page)).toHaveText(`Photo 1 of ${total}: ${alts[0]}`);
  });

  test("Escape closes and returns focus to the thumbnail that opened it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");
    const opener = thumbs(page).nth(2);
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(status(page)).toHaveText("");
  });

  test("open at 320px: no horizontal scroll, every control reachable", async ({
    page,
  }) => {
    await openFirst(page, 320);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    for (const name of ["Previous photo", "Next photo", "Close photo viewer"]) {
      const button = dialog(page).getByRole("button", { name });
      await expect(button).toBeInViewport();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    await expect(dialogImg(page)).toBeInViewport();
    await dialog(page)
      .getByRole("button", { name: "Close photo viewer" })
      .click();
    await expect(dialog(page)).toBeHidden();
  });

  test("axe: no violations with the lightbox open", async ({ page }) => {
    await openFirst(page);
    await dialog(page).getByRole("button", { name: "Next photo" }).click();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("pricing", () => {
  test("/pricing has one h1, a grade card per category and a focusable table region", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await expect(page.locator("h1")).toHaveCount(1);
    for (const id of [
      "residential",
      "critical",
      "industrial",
      "spark-arrestors",
    ]) {
      await expect(page.locator(`article#${id}`)).toHaveCount(1);
    }
    const region = page.locator(
      '[role="region"][aria-labelledby="size-prices-caption"]',
    );
    await expect(region).toHaveAttribute("tabindex", "0");
    await expect(region.locator("caption")).toHaveCount(1);
    await expect(region.locator('th[scope="row"]')).toHaveCount(9);
  });

  test("product page See pricing jumps to #pricing, which ends with a quote button", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/products/se40");
    const section = page.locator("section#pricing");
    await expect(section).toHaveAttribute("aria-labelledby", "pricing-heading");
    await page.getByRole("link", { name: "See pricing for the SE40" }).click();
    await expect(page).toHaveURL(/#pricing$/);
    await expect(
      section.getByRole("heading", { name: "Indicative pricing" }),
    ).toBeInViewport();
    await expect(
      section.getByRole("link", { name: "Get a quote for SE40" }),
    ).toBeVisible();
  });
});

test.describe("legal tables", () => {
  test("/cookies table headers carry scope=col", async ({ page }) => {
    await page.goto("/cookies");
    const headers = page.locator(".legal-prose thead th");
    expect(await headers.count()).toBeGreaterThan(0);
    for (const th of await headers.all()) {
      await expect(th).toHaveAttribute("scope", "col");
    }
  });
});
