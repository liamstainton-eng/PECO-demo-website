# Peco Silencers website (demo)

Redesign of [pecoindustrial.co.uk](https://pecoindustrial.co.uk) for Peco Silencers Ltd, a UK manufacturer of industrial exhaust, spark arrestor and intake silencers. Built as a static site so every page leads to a quote and product specs are real HTML, not images.

**Status:** Milestone 1 demo. Product size tables, category grouping and legal text are awaiting client confirmation (kept in local-only internal docs). Not yet live.

## Stack

- [Astro 7](https://docs.astro.build) (static output), Tailwind CSS 4, IBM Plex Sans via the Astro Fonts API
- Content collections: products (JSON), size tables (CSV validated at build), categories, projects, legal pages
- Hosting target: Cloudflare Pages (`public/_redirects`, generated `dist/_headers`)

## Commands

| Command                                     | Action                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm install`                               | Install dependencies (then `npm approve-scripts workerd` for wrangler)                          |
| `npm run dev`                               | Dev server at `localhost:4321`                                                                  |
| `npm run build`                             | Build to `dist/` and write `dist/_headers`                                                      |
| `npm run preview`                           | Preview the build                                                                               |
| `npm run check`                             | Astro and TypeScript checks                                                                     |
| `npm run test`                              | Unit tests (`node --test`)                                                                      |
| `npm run verify:data`                       | Sanity-check product data and size tables                                                       |
| `npm run verify:dist`                       | Check built pages (phone link, quote CTA, one H1, alt text, banned strings) and colour contrast |
| `npm run e2e`                               | Playwright + axe accessibility tests                                                            |
| `npm run verify`                            | All of the above except e2e                                                                     |
| `node scripts/check-redirects.mjs --static` | Validate the old-URL redirect map                                                               |

Builds without `LAUNCH=1` are staging: `noindex` headers, a `noindex,nofollow` robots meta tag on every page and visible `TODO(client)` markers. Set `LAUNCH=1` only in the production environment.

## Demo hosting

A view-only demo for review is published to GitHub Pages at <https://liamstainton-eng.github.io/PECO-demo-website/> by `.github/workflows/pages.yml` on every push to `main` (or a manual run). It is built with `DEPLOY_TARGET=gh-pages`, which serves the site under the `/PECO-demo-website` base; internal links and public assets go through `url()` in `src/lib/url.ts`.

- The demo is noindexed: every page has `<meta name="robots" content="noindex,nofollow">` (GitHub Pages ignores `_headers`, so the `X-Robots-Tag` header does not apply there), and canonicals point at `https://www.pecoindustrial.co.uk`.
- Cloudflare Pages remains the production target: the default build (no `DEPLOY_TARGET`) is unchanged, with base `/`.
- Check a demo build locally: `DEPLOY_TARGET=gh-pages npx astro build --outDir dist-gh` then `node scripts/check-dist.mjs --dir dist-gh --base /PECO-demo-website`.
- The repo's Pages source must be set to "GitHub Actions" (Settings > Pages).

## Editing content

- Phone, email, address and the quote link: `src/config.yaml`
- Navigation: `src/navigation.ts`
- Products: `src/content/products/*.json`
- Size tables: `src/content/sizes/*.csv`. Edit in a text editor, never save from Excel (it turns fractions into dates; the build will fail).

## Docs

- `docs/internal/` (local only, not published): original brief and audit, implementation plan, client questions, crawl data
- `docs/decisions.md`: verified platform facts
- `docs/old-urls.csv`: old URL inventory and redirect decisions
- `docs/qa/`: Codex audit and triage, Lighthouse summary, redirect reports, screenshots

## Release checks

- `npm run verify:all`: fresh build, every check, Playwright + axe, link crawl
- `npm run qa:lighthouse`: Lighthouse mobile median of 3 with the build identity
- `npm run verify:launch`: fails until every launch blocker is cleared (client approvals, verified size tables, analytics token). Runs automatically when `LAUNCH=1`.

## Credits

Component patterns adapted from [AstroWind](https://github.com/onwidget/astrowind) (MIT). Form and cookie patterns follow the [GOV.UK Design System](https://design-system.service.gov.uk/). See `CREDITS.md`.

Product data, copy and images belong to Peco Silencers Ltd.
