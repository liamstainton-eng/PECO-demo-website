# Peco Silencers website (demo)

Redesign of [pecoindustrial.co.uk](https://pecoindustrial.co.uk) for Peco Silencers Ltd, a UK manufacturer of industrial exhaust, spark arrestor and intake silencers. Built as a static site so every page leads to a quote and product specs are real HTML, not images.

**Status:** Milestone 1 demo. Product size tables, category grouping and legal text are awaiting client confirmation (see `docs/client-questions.md`). Not yet live.

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

Builds without `LAUNCH=1` are staging: `noindex` headers and visible `TODO(client)` markers. Set `LAUNCH=1` only in the production environment.

## Editing content

- Phone, email, address and the quote link: `src/config.yaml`
- Navigation: `src/navigation.ts`
- Products: `src/content/products/*.json`
- Size tables: `src/content/sizes/*.csv`. Edit in a text editor, never save from Excel (it turns fractions into dates; the build will fail).

## Docs

- `docs/handover.md`: original audit and brief
- `docs/plan.md`: approved implementation plan and ADR
- `docs/decisions.md`: verified platform facts
- `docs/client-questions.md`: open questions for Peco
- `docs/old-urls.csv`: old URL inventory and redirect decisions

## Credits

Component patterns adapted from [AstroWind](https://github.com/onwidget/astrowind) (MIT). Form and cookie patterns follow the [GOV.UK Design System](https://design-system.service.gov.uk/). See `CREDITS.md`.

Product data, copy and images belong to Peco Silencers Ltd.
