The site is a polished staging shell pretending to have a launch-grade catalogue and QA pipeline. The core buyer need—reliable dimensions for choosing the correct silencer—is largely unmet, approval gates are porous, accessibility claims exceed the evidence, and several important validators are never run by the supposedly comprehensive verification command. **Overall grade: 3/10.**

## Critical

1. **The launch gate does not enforce content approval** — `scripts/check-dist.mjs:134`, `src/components/product/CategoryView.astro:54`, `src/components/common/LegalPage.astro:21`, `docs/plan.md:276`

   `LAUNCH=1` only rejects rendered `TODO(client)` strings. It never reads `approved`. Category warnings disappear in launch mode, and category TODO paragraphs are deleted or rewritten by `applyTodoRuleToHtml`, so all four `approved: false` categories can escape detection. A legal document would also pass while still `approved: false` once its visible TODOs were removed.

   This makes the promised client-approval gate fictional. Unapproved product grouping or legal wording can reach production.

   **Fix:** Add a pre-build source-level launch validator that fails unless every category and legal entry has `approved: true`. Do not infer approval from the absence of rendered TODO text.

2. **Fixture and unverified product data can be presented as production data** — `src/components/product/ProductView.astro:128`, `src/components/product/ProductView.astro:141`, `src/content/products/sea.json:95`, `src/content/sizes/sea.csv:2`

   SEA contains only three fixture rows, every product has `verification: null`, and launch mode merely removes the fixture warning while continuing to render those three rows. Nothing forbids `sizesStatus: "fixture"` in a launch build.

   An engineer can reasonably mistake a three-row sample for the available product range. That is a quotation and specification risk, not cosmetic incompleteness.

   **Fix:** Fail launch on `fixture`, `pending-transcription`, or missing verification unless a narrowly documented client-approved exception exists. Require a completed verification record and expected row count for every shipped table.

## High

1. **The product catalogue does not contain the product specifications buyers came for** — `src/content/products/sa1.json:82`, `se20.json:77`, `se30.json:77`, `se40.json:77`, `se50.json:77`, `sls.json:89`, `sa2.json:19`, `se30-abs.json:19`

   Six tables are pending transcription, two have no table, and SEA has only three fixture rows. Pending products display a raster datasheet with “Full size table coming soon”; SA2 and SE30 ABS provide only “Specifications on request.”

   Buyers cannot compare bores, dimensions or weights as accessible text, and the claimed M1 deliverable of product specification tables is not delivered.

   **Fix:** Transcribe, independently verify and approve every available datasheet table. For genuinely unavailable data, document the client-approved exception and provide a tightly prefilled enquiry link.

2. **`npm run verify` omits most of the tests the plan relies on** — `package.json:14-19`

   The command does not run Playwright, axe, linkinator, Lighthouse, `check-jsonld.mjs`, or `check-redirects.mjs`. A build can therefore be declared verified with broken keyboard interactions, broken links, invalid structured data or bad redirects.

   **Fix:** Make one CI command run a fresh build followed by unit tests, data validation, strict JSON-LD checks, redirect static checks, link checking, Playwright/axe and thresholded Lighthouse runs. Do not rely on manually saved artifacts.

3. **The data validator can excuse corrupt measurements with any arbitrary note** — `scripts/check-products.mjs:145-190`, `src/content/sizes/sea.csv:2-4`

   Any non-empty row note downgrades every conversion, weight and bore-order failure to a warning. All SEA rows carry the same generic fixture note, so that note would also excuse an unrelated bad dimension. The plan requires sequential part numbers, but the script checks only duplicates and bore order.

   **Fix:** Use structured anomaly codes tied to specific cells and rules. Make unexplained anomalies fatal, enforce model-specific part-number sequences, positive dimensions/counts, expected rows and verification status.

4. **The content schema’s strongest-looking validation is effectively a type assertion** — `src/content.config.ts:61-104`

   `z.custom<SizeRow>()` performs no structural runtime validation. Product/category strings are often allowed to be empty, and relationships between status, verification, columns and available files are enforced inconsistently in separate scripts.

   **Fix:** Define real Zod schemas for every cell variant and row. Encode status/file/verification invariants in one schema or one mandatory validation phase.

5. **The mobile menu behaves like a modal without modal focus management** — `src/components/widgets/Header.astro:303-327`

   Opening it only unhides the panel and prevents scrolling. Focus is not moved into the menu, background content is not inert, and Tab is not contained, so keyboard users can move into controls hidden beneath the full-screen overlay.

   **Fix:** Move focus to the first menu control, make the rest of the page inert while open, contain focus, restore focus on every close path, and test forward/reverse tabbing.

6. **WCAG 2.2 AA is asserted from inadequate evidence** — `tests/e2e/layout.spec.ts:26-67`, `scripts/check-contrast.mjs:22-42`, `playwright.config.ts:18`

   Axe failures are filtered to serious/critical only. The 320px test checks initial document width but not open menus, dialogs, zoom or text resizing. Contrast checking covers a hand-picked token list rather than rendered elements, opacity, image overlays and literal colours. Tests use one desktop-Chrome project resized to mobile widths.

   **Fix:** Test all axe violations requiring remediation, keyboard sequences, 200%/400% zoom, text spacing, interactive states and actual computed contrast. Add real mobile/touch browser profiles and manual assistive-technology checks.

7. **Redirect acceptance is not demonstrated and special cases cannot fail** — `scripts/check-redirects.mjs:150-216`, `docs/plan.md:267-270`

   The redirect script is not part of `verify`. Its `?rCH=2` and `/index.php?option=com_content` checks are informational strings only; incorrect responses do not fail. There is no retained live staging report proving all 112 redirects return 301→200 and the remaining classified URLs return the intended 404.

   **Fix:** Wire strict static and live redirect checks into deployment verification, turn the probes into assertions, and retain results for both apex and `www`.

8. **Versioned Cloudflare preview aliases can be indexed in a production build** — `scripts/write-headers.mjs:23-26`, `docs/decisions.md:15-17`

   The generated host rule covers `https://:project.pages.dev/*` but omits the documented `https://:version.:project.pages.dev/*` form. With `LAUNCH=1`, the global noindex disappears, leaving versioned deployment aliases exposed.

   **Fix:** Add the versioned-host rule and verify response headers against actual production and preview aliases before cutover.

9. **Legal pages are drafts and make an analytics claim the built site cannot substantiate** — `src/content/legal/privacy.md:4-62`, `src/content/legal/cookies.md:4-29`, `src/config.yaml:37-40`

   All legal pages remain unapproved. Privacy contains unresolved company, ICO, VAT, provider, contact and retention fields. Cookies and privacy say Cloudflare Web Analytics is used, but the token is empty, there is no Analytics component, and the built HTML contains no analytics request.

   **Fix:** Confirm the deployed analytics mechanism, make the legal text match reality, resolve every company/retention field, obtain approval, then set `approved: true`.

## Medium

1. **The gallery lightbox hides the actual image description from assistive technology** — `src/components/widgets/Gallery.astro:60-70`, `src/components/widgets/Gallery.astro:92-98`

   The dialog image always has `alt=""`. Its changing caption is neither connected with `aria-describedby` nor live-announced. Arrow navigation announces only “n of 18,” not what the new image shows.

   **Fix:** Give the active image an appropriate alt or associate a stable caption ID with the dialog/image, and announce caption changes without duplicating speech.

2. **The projects page is a context-free image dump** — `src/content/projects/projects.json:3-80`, `src/pages/projects.astro:19-30`

   Every inspected project has null caption, sector and product. The page claims these are Peco-designed/manufactured projects but gives buyers no application, model, constraint or outcome.

   **Fix:** Obtain sourced captions and classifications from Peco. Until then, use neutral “workshop and installation photos” wording and do not present the gallery as evidence of project outcomes.

3. **The sitemap advertises pages that are explicitly noindex or deliberately hidden** — `astro.config.mjs:36-43`, built `/sitemap-0.xml`

   `/privacy`, `/terms` and `/cookies` are included despite their draft `noindex` metadata. `/pricing` is always included even though launch mode removes pricing navigation when all prices are null, producing an indexable orphan placeholder.

   **Fix:** Generate the sitemap from approval and publication state. Exclude noindex legal drafts and exclude or noindex pricing until it contains approved information.

4. **The CSV parser accepts malformed and nonsensical values** — `src/lib/csv.ts:56-59`, `src/lib/csv.ts:86-124`, `src/lib/csv.ts:219-244`

   Text after a closing quote is accepted instead of rejected. Fractions such as `1/0` pass the regex. Zero hole counts and zero dimensions/weights are accepted. `raw2:` is technically allowed for any paired column despite being documented as a specific datasheet exception.

   **Fix:** Implement a state that only accepts delimiter/newline after a closing quote, parse and validate fractions, require positive domain values, and restrict special encodings by product and column.

5. **HTML validation is regex-based and trivially fooled** — `scripts/check-dist.mjs:55-70`, `scripts/check-dist.mjs:82-143`

   A bare or empty `alt` passes. Hidden links can satisfy phone and quote requirements. Only anchor `href`s are checked; broken images, `srcset`, stylesheets, scripts and canonical targets are ignored. Visibility at each viewport is not tested.

   **Fix:** Parse HTML with a real parser, validate all referenced assets and metadata, reject empty alt where the image is meaningful, and use browser assertions for visible header actions.

6. **Markdown tables lose explicit header semantics** — built URL `/cookies`

   The generated cookie table has `<th>` elements without `scope="col"`. That may be inferred by browsers, but it is weaker than the explicit semantics used elsewhere and contradicts the claimed table discipline.

   **Fix:** render legal tables through a component/Markdown extension that adds `scope="col"` and accessible captions where needed.

7. **The site publicly announces its unfinished information architecture** — `src/pages/about.astro:66-70`

   “These products and services do not have their own pages yet” is internal project commentary presented to buyers. It makes the site look abandoned and turns every secondary service into a generic email action.

   **Fix:** Replace it with buyer-facing wording such as “Ask us about these additional products and services,” or add concise sourced service pages.

8. **The saved performance evidence avoids several likely worst cases** — `scripts/run-lighthouse.mjs`, `docs/qa/lighthouse/summary.json`

   The five stored runs score 100, but they omit projects, pricing, SA1 and the products rendering full datasheet images. The evidence is not tied to a commit/build digest and is not regenerated by `verify`.

   **Fix:** Add the heaviest page types, store build identity with results and make threshold checks mandatory in CI.

9. **Source material contradicts itself over the SA catalytic-converter option** — `docs/handover.md:125-126`, `src/content/products/sa1.json:13-25`

   The handover says SA has no catalytic converter, while the product record—and the captured datasheet options image—includes one. The rendered claim may be correct, but the audit trail is unresolved.

   **Fix:** Record which source has authority and get explicit client confirmation; then correct the handover or product data so future editors do not reverse it.

10. **The security policy stops at a minimal header set** — `scripts/write-headers.mjs:16-27`, `src/layouts/Layout.astro:27`

   There is no CSP or HSTS declaration, while inline scripts are used throughout. The exact Astro generator version is also emitted in every page. CSP was deliberately deferred, but it remains an unmitigated launch risk.

   **Fix:** remove the generator meta tag, configure HSTS at the serving layer, and implement/report-test a CSP before enabling enforcement.

## Low

1. **Social image metadata is incomplete** — `src/components/common/Metadata.astro:35-47`

   OG and Twitter images have no corresponding alt metadata. Shared links therefore lack a textual description of the preview image.

   **Fix:** add `og:image:alt` and `twitter:image:alt`, with page-specific values where images differ.

2. **Mobile conversion controls are visually repetitive** — built URL `/`

   The mobile home view presents header quote/call controls, a hero quote button and a fixed quote/call bar in the same initial experience. It is conversion-heavy to the point of noise and reduces space available for the product proposition.

   **Fix:** retain one persistent mobile contact treatment and one contextual primary CTA; remove redundant variants from the same viewport.

3. **Product and route knowledge is duplicated across unrelated files** — `src/content/slugs.ts`, `src/navigation.ts`, `scripts/check-jsonld.mjs:19-30`, redirect tooling

   Model lists and category relationships are hard-coded repeatedly. A future product edit can update content while silently leaving navigation, structured-data expectations or redirects behind.

   **Fix:** derive these consumers from one validated manifest or generated build artifact.

## Plan compliance failures

| Criterion | Status |
|---|---|
| Section 5 #1 / T1: visible phone and quote action on every page and viewport | Present structurally, but all-page viewport visibility is not demonstrated; browser tests do not assert it. |
| Section 5 #4: specifications as HTML text | Not met. Only three SEA fixture rows are HTML; most tables remain images or “Ask us.” |
| Section 5 #6: analytics/cookie behaviour | Not demonstrated. Legal copy says analytics is active, but no analytics request exists in the built output. |
| Section 5 #7: approved UK legal wording | Not met. All three entries have `approved: false`; privacy and terms retain unresolved client fields. |
| Section 5 #9: optimised images with useful alt | Partially met. The lightbox deliberately uses empty alt and does not expose its caption correctly. |
| Section 5 #10: redirects proven for every old URL | Not demonstrated against a deployment; special query cases cannot fail the validator. |
| T1: WCAG contrast and 320px reflow | Not demonstrated. The contrast script checks selected tokens only; Playwright is outside `verify`, and no run artifact is retained. |
| T2: strict loader and full transcription | Not met. The parser has malformed-input gaps; only one three-row fixture exists. |
| T2: sequential part numbers and unexplained anomaly rejection | Not met. Sequential numbering is not checked, and any note excuses any anomaly. |
| T2: dispute resolution, three-row-per-model spot checks and client sign-off | Not met. Every product has `verification: null`; there is no sign-off evidence. |
| T3: specification values present as text | Not met for eight products and incomplete for SEA. |
| T3: screenshots at 375px and 1280px in `docs/qa/` | Not met. `docs/qa/` contains only Lighthouse output. |
| T6: zero broken links and zero serious/critical axe failures as part of the release gate | Not demonstrable from `npm run verify`; neither linkinator nor Playwright is invoked. |

Section 5 #5 is explicitly M2 and is not an M1 failure. The stored Lighthouse medians satisfy the numeric thresholds, but the results are stale-able artifacts rather than an enforced build gate.

## Top 5 fixes

1. Implement a source-level launch gate for approvals, product status, verification and expected row completeness.
2. Finish and independently verify the specification tables; do not ship SEA fixture rows as production data.
3. Replace the fragmented QA commands with one fresh-build CI gate covering e2e, axe, links, redirects, JSON-LD and Lighthouse.
4. Fix mobile-menu focus containment and the gallery’s screen-reader behaviour, then test real interaction states at 320px.
5. Resolve and approve the legal/analytics content, correct sitemap publication rules, and protect every Cloudflare preview hostname from indexing.