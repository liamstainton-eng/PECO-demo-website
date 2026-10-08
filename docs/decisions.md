# Decisions and verified platform facts

Verified 2026-10-08 (T0c) against official docs and installed `node_modules/astro` 7.3.8. See `plan.md` for the full ADR.

## Astro 7.3.8

- Content layer: `defineCollection`, `reference` from `astro:content`; `glob`, `file` from `astro/loaders`; `z` from `astro/zod` (Zod 4).
- Inline object loader: `{ name, load({ store, parseData, generateDigest, logger }) }`; call `store.clear()` then `store.set({ id, data, digest })`. Function loaders get no context.
- `image()` in `glob()` JSON schemas: `./x.png` resolves relative to the JSON file; aliases pass to Vite. Inline loaders have no relative resolution unless `filePath` is passed to `parseData`.
- `reference('products')` validates at load time (missing entry logs a validation error).
- Fonts API is stable: top-level `fonts: [{ name, cssVariable, provider: fontProviders.google() }]`; `<Font cssVariable preload />` from `astro:assets`; self-hosted under `/_astro/fonts`.

## Cloudflare Pages

- `_redirects`: 2,000 static + 100 dynamic rules; 301/302/303/307/308; one splat per rule; first match wins; static before dynamic. Query strings cannot be matched.
- **Not verified:** mid-path splats (`/*/87-...`), query pass-through, `.php` source paths. Decision: generate **explicit static rules** for every discovered old URL (no mid-path splats); test on a preview deploy before cutover.
- `_headers`: host rules `https://:project.pages.dev/*` and `https://:version.:project.pages.dev/*` documented for noindex; 100 rules max; **not applied to Pages Functions responses** (set headers in Function code, M2).
- wrangler.toml for Pages (M2): `name`, `pages_build_output_dir = "./dist"`, `compatibility_date`, `[[kv_namespaces]]`; file becomes source of truth over dashboard.
- Turnstile: `refresh-expired` default `auto`; tokens 300 s, single-use; `turnstile.reset(widgetId)`.

## Tooling

- npm 11 blocks dependency install scripts by default; `workerd` (wrangler runtime) approved via `npm approve-scripts workerd`.
- Python venv at `tools/.venv` (Pillow 12.3.0); run scripts with `python -I`.
- AstroWind reference: `onwidget/astrowind@14e1a691f80548dcc36370847b1a02c0d0b12821` (MIT), read from a scratch clone outside the repo.
