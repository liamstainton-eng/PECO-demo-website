// @ts-check
import { defineConfig, fontProviders } from "astro/config";

import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { satteri } from "@astrojs/markdown-satteri";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { allTiers, hasAnyPrice } from "./src/lib/pricing-core.ts";
import { stripBase, url } from "./src/lib/url.ts";

const LAUNCH = process.env.LAUNCH === "1";

// DEPLOY_TARGET=gh-pages: the shareable demo on GitHub Pages, a project site
// served under /PECO-demo-website. Every other build (Cloudflare Pages) keeps
// Astro's default base "/" and the real domain.
const GH_PAGES = process.env.DEPLOY_TARGET === "gh-pages";
const BASE = GH_PAGES ? "/PECO-demo-website" : "/";

// Sitemap publication rules, read from the same sources the pages use:
// - legal pages render noindex until their entry is approved: true;
// - /pricing renders noindex in a launch build until at least one price exists
//   (PRICING_LIVE in src/lib/pricing.ts).
/** @param {string} slug */
const legalApproved = (slug) => {
  const md = readFileSync(new URL(`./src/content/legal/${slug}.md`, import.meta.url), "utf8");
  const front = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return front ? parseYaml(front[1])?.approved === true : false;
};
const pricingData = JSON.parse(
  readFileSync(new URL("./src/data/pricing.json", import.meta.url), "utf8"),
);
const PRICING_LIVE = !LAUNCH || hasAnyPrice(allTiers(pricingData));
const unlisted = new Set([
  "/404",
  ...["privacy", "terms", "cookies"].filter((s) => !legalApproved(s)).map((s) => `/${s}`),
  ...(PRICING_LIVE ? [] : ["/pricing"]),
]);

// Markdown tables (legal pages): explicit header scope. A <th> in <thead> gets
// scope="col"; a <th> that starts a <tbody> row gets scope="row". Astro 7 renders
// Markdown with Sätteri, so this is a Sätteri hast plugin passed to the default
// processor (markdown.rehypePlugins would need @astrojs/markdown-remark).
/** @type {import("satteri").HastPluginDefinition} */
const tableHeaderScope = {
  name: "table-header-scope",
  element: {
    filter: ["th"],
    visit(node, ctx) {
      const row = ctx.parent(node);
      const section = row && ctx.parent(row);
      if (section?.type !== "element") return;
      if (section.tagName === "thead") {
        ctx.setProperty(node, "scope", "col");
      } else if (section.tagName === "tbody") {
        const at = ctx.indexOf(node) ?? 0;
        const firstCell = row.children.slice(0, at).every((c) => c.type !== "element");
        if (firstCell) ctx.setProperty(node, "scope", "row");
      }
    },
  },
};

// build.format 'file' + trailingSlash 'never': /about builds to about.html.
// Cloudflare Pages serves about.html at /about (and redirects /about.html to
// /about), so URLs stay clean with no trailing slash. 'directory' would build
// about/index.html, which Pages serves at /about/ and redirects /about to,
// contradicting trailingSlash 'never' and the canonical URLs.
// Root-relative links in Markdown (legal pages: /privacy, /cookies) get the
// base. Only added to the GitHub Pages build; with base "/" it is a no-op.
/** @type {import("satteri").HastPluginDefinition} */
const baseLinks = {
  name: "base-links",
  element: {
    filter: ["a"],
    visit(node, ctx) {
      const href = node.properties?.href;
      if (typeof href === "string") ctx.setProperty(node, "href", url(href, BASE));
    },
  },
};

// GitHub Pages also serves about.html at /about (extensionless), so the same
// 'file' format and trailingSlash 'never' work under the /PECO-demo-website base.
// https://astro.build/config
export default defineConfig({
  site: GH_PAGES ? "https://liamstainton-eng.github.io" : "https://www.pecoindustrial.co.uk",
  ...(GH_PAGES ? { base: BASE } : {}),
  trailingSlash: "never",
  build: {
    format: "file",
  },

  fonts: [
    {
      provider: fontProviders.google(),
      name: "IBM Plex Sans",
      cssVariable: "--font-sans-plex",
      weights: [400, 500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["Arial", "sans-serif"],
    },
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  markdown: {
    processor: satteri({
      hastPlugins: [tableHeaderScope, ...(GH_PAGES ? [baseLinks] : [])],
    }),
  },

  integrations: [
    sitemap({
      filter: (page) => {
        const path = stripBase(new URL(page).pathname, BASE)
          .replace(/\.html$/, "")
          .replace(/\/$/, "");
        return !unlisted.has(path) && !path.startsWith("/quote/thank-you");
      },
    }),
  ],
});
