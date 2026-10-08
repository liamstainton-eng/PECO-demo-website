// @ts-check
import { defineConfig, fontProviders } from "astro/config";

import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// build.format 'file' + trailingSlash 'never': /about builds to about.html.
// Cloudflare Pages serves about.html at /about (and redirects /about.html to
// /about), so URLs stay clean with no trailing slash. 'directory' would build
// about/index.html, which Pages serves at /about/ and redirects /about to,
// contradicting trailingSlash 'never' and the canonical URLs.
// https://astro.build/config
export default defineConfig({
  site: "https://www.pecoindustrial.co.uk",
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

  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname
          .replace(/\.html$/, "")
          .replace(/\/$/, "");
        return path !== "/404" && !path.startsWith("/quote/thank-you");
      },
    }),
  ],
});
