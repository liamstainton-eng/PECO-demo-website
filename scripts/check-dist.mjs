#!/usr/bin/env node
// Post-build checks over every HTML page in a dist dir (default dist/). No dependencies.
//
//   node scripts/check-dist.mjs [--dir <path>] [--skip-links]
//
// Pages are tokenised into elements with an open-element stack (script/style
// bodies and comments removed), so ancestry (hidden, aria-hidden) is known.
// Per page:
// - a tel link and a "Get a quote" link (M1 mailto or M2 /quote) that are not
//   inside a `hidden` or aria-hidden="true" subtree (CSS visibility per viewport
//   is the job of the Playwright suite);
// - exactly one <h1>; banned strings absent; <title> present and unique; meta
//   description present;
// - every <img> has an alt attribute. An empty alt (alt="" or bare `alt`, which is
//   how Astro renders alt="") is allowed only for a decorative image: role
//   "presentation"/"none", or aria-hidden="true" on the image or an ancestor;
// - every local asset reference exists in the dist dir: img/source src and srcset,
//   script src, link href (stylesheet, preload, modulepreload, icon, manifest),
//   video/audio src and poster, og:image / twitter:image, url() in inline styles
//   and in the referenced local CSS files;
// - exactly one canonical link, an absolute https://www.pecoindustrial.co.uk URL
//   whose path is a built page.
// Then internal <a href> existence (unless --skip-links).
// LAUNCH=1: any "TODO(client)" fails. Otherwise TODO(client) counts are reported.
// The source-level launch gate (approvals, fixture data) is check-launch.mjs.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const dirIdx = args.indexOf("--dir");
const DIST = resolve(dirIdx >= 0 ? args[dirIdx + 1] : "dist");
const SKIP_LINKS = args.includes("--skip-links");
const LAUNCH = process.env.LAUNCH === "1";

const ORIGIN = "https://www.pecoindustrial.co.uk";
const TEL = "tel:01513430330";
const QUOTE_MAILTO = "mailto:sales@pecoindustrial.co.uk";
const QUOTE_PATH = "/quote";
const QUOTE_TEXT = "get a quote";
const BANNED = [
  "Adress",
  "ARRESOR",
  "there range",
  "fa-chrome",
  "Omega Media",
  "omegamedia",
  "Dexters",
];
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const ASSET_LINK_RELS = [
  "stylesheet",
  "preload",
  "modulepreload",
  "icon",
  "apple-touch-icon",
  "manifest",
];

if (!existsSync(DIST)) {
  console.error(`check-dist: ${DIST} not found, run a build first`);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const stripTags = (s) =>
  decode(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** Attributes of a start tag as a Map (names lower-cased; a bare attribute has value ""). */
function parseAttrs(src) {
  const attrs = new Map();
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of src.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decode(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return attrs;
}

/**
 * Tokenise start tags with their ancestry. Returns elements in document order:
 * { name, attrs, end, hidden, ariaHidden } where `end` is the index just after
 * the start tag, `hidden` = inside (or is) a `hidden` or aria-hidden="true"
 * subtree, `ariaHidden` = inside (or is) an aria-hidden="true" subtree.
 */
function scan(content) {
  const elements = [];
  const stack = [];
  const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  for (const m of content.matchAll(TAG)) {
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.findLastIndex((e) => e.name === name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const attrs = parseAttrs(m[3]);
    const parent = stack.at(-1);
    const selfAria = attrs.get("aria-hidden") === "true";
    const el = {
      name,
      attrs,
      end: m.index + m[0].length,
      ariaHidden: (parent?.ariaHidden ?? false) || selfAria,
      hidden: (parent?.hidden ?? false) || selfAria || attrs.has("hidden"),
    };
    elements.push(el);
    if (!VOID.has(name) && !/\/\s*$/.test(m[3])) stack.push(el);
  }
  return elements;
}

const files = walk(DIST).filter((f) => f.endsWith(".html"));
const pageOf = (f) => "/" + relative(DIST, f).split(sep).join("/");
/** URL path a page is served at: /products/sea.html -> /products/sea, /index.html -> /. */
const urlPathOf = (page) =>
  page.replace(/\.html$/, "").replace(/(^|\/)index$/, "/") || "/";

const failures = [];
const warnings = [];
const fail = (page, msg) => failures.push(`${page}: ${msg}`);
const warn = (page, msg) => warnings.push(`${page}: ${msg}`);
const titles = new Map();
const todoCounts = [];
const links = [];
const assets = new Map(); // dist path -> first page referencing it
const cssFiles = new Set();

/**
 * Site-local path of a reference, resolved against the page URL; null for
 * external, data:, fragment-only and non-http references.
 */
function localPath(ref, page) {
  const r = ref.trim();
  if (!r || r.startsWith("#") || /^(data|mailto|tel|javascript):/i.test(r))
    return null;
  let u;
  try {
    u = new URL(r, ORIGIN + urlPathOf(page));
  } catch {
    return undefined;
  }
  if (u.origin !== ORIGIN) return null;
  try {
    return decodeURIComponent(u.pathname);
  } catch {
    return undefined;
  }
}

function addAsset(page, ref, what) {
  if (ref.trim() === "") {
    warn(page, `${what} is empty`);
    return;
  }
  const p = localPath(ref, page);
  if (p === undefined) return fail(page, `${what} is not a valid URL: ${ref}`);
  if (p === null) return;
  if (!assets.has(p)) assets.set(p, `${page} (${what})`);
  if (p.endsWith(".css")) cssFiles.add(p);
}

const srcsetUrls = (v) =>
  v
    .split(/,\s+/)
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);

for (const file of files) {
  const page = pageOf(file);
  const html = readFileSync(file, "utf8");
  // Drop comments and <script>/<style> bodies so code never counts as content.
  const content = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/gi, "<$1$2></$1>");
  const els = scan(content);

  const anchors = els
    .filter((e) => e.name === "a")
    .map((e) => {
      const close = content.indexOf("</a>", e.end);
      return {
        href: e.attrs.get("href") ?? "",
        text: stripTags(
          content.slice(e.end, close < 0 ? e.end : close),
        ).toLowerCase(),
        hidden: e.hidden,
      };
    });

  const tel = anchors.filter((a) => a.href === TEL);
  if (tel.length === 0) fail(page, `missing href="${TEL}"`);
  else if (tel.every((a) => a.hidden))
    fail(page, `every href="${TEL}" link is inside a hidden subtree`);

  const quote = anchors.filter((a) => a.text === QUOTE_TEXT);
  if (quote.length === 0) fail(page, 'no "Get a quote" link');
  else if (quote.every((a) => a.hidden))
    fail(page, 'every "Get a quote" link is inside a hidden subtree');
  for (const q of quote) {
    if (!(
      q.href.startsWith(QUOTE_MAILTO) ||
      q.href === QUOTE_PATH ||
      q.href.startsWith(`${QUOTE_PATH}?`)
    )) {
      fail(page, `"Get a quote" link has unexpected href "${q.href}"`);
    }
  }

  const h1s = els.filter((e) => e.name === "h1").length;
  if (h1s !== 1) fail(page, `expected exactly one <h1>, found ${h1s}`);

  for (const e of els.filter((e) => e.name === "img")) {
    const src = e.attrs.get("src");
    const label = `<img src="${src ?? ""}">`;
    if (!e.attrs.has("alt")) fail(page, `${label} without alt`);
    else if (e.attrs.get("alt").trim() === "") {
      const role = e.attrs.get("role");
      const decorative =
        role === "presentation" || role === "none" || e.ariaHidden;
      if (!decorative)
        fail(
          page,
          `${label} has an empty alt but is not marked decorative (role="presentation" or aria-hidden="true")`,
        );
    }
  }

  // Asset references.
  for (const e of els) {
    const a = e.attrs;
    if (e.name === "img" || e.name === "source") {
      if (a.has("src")) addAsset(page, a.get("src"), `<${e.name}> src`);
      if (a.has("srcset"))
        for (const u of srcsetUrls(a.get("srcset")))
          addAsset(page, u, `<${e.name}> srcset`);
    } else if (e.name === "script" && a.has("src")) {
      addAsset(page, a.get("src"), "<script> src");
    } else if (e.name === "video" || e.name === "audio") {
      if (a.has("src")) addAsset(page, a.get("src"), `<${e.name}> src`);
      if (a.has("poster")) addAsset(page, a.get("poster"), "<video> poster");
    } else if (e.name === "link") {
      const rels = (a.get("rel") ?? "").toLowerCase().split(/\s+/);
      if (rels.some((r) => ASSET_LINK_RELS.includes(r)) && a.has("href"))
        addAsset(page, a.get("href"), `<link rel="${a.get("rel")}">`);
    } else if (e.name === "meta") {
      const key = a.get("property") ?? a.get("name");
      if (key === "og:image" || key === "twitter:image")
        addAsset(page, a.get("content") ?? "", key);
    }
  }
  for (const m of html.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g))
    addAsset(page, m[2], "inline url()");

  const canonicals = els.filter(
    (e) =>
      e.name === "link" &&
      (e.attrs.get("rel") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .includes("canonical"),
  );
  if (canonicals.length !== 1)
    fail(
      page,
      `expected exactly one canonical link, found ${canonicals.length}`,
    );
  for (const c of canonicals) {
    const href = c.attrs.get("href") ?? "";
    if (href !== ORIGIN && !href.startsWith(ORIGIN + "/"))
      fail(page, `canonical is not an absolute ${ORIGIN} URL: "${href}"`);
    else if (!resolves(new URL(href).pathname))
      fail(page, `canonical ${href} is not a built page`);
  }

  const lower = html.toLowerCase();
  for (const b of BANNED) {
    if (lower.includes(b.toLowerCase())) fail(page, `banned string "${b}"`);
  }

  const title = content.match(/<title>([\s\S]*?)<\/title>/i);
  if (!title || !stripTags(title[1])) fail(page, "missing <title>");
  else {
    const t = stripTags(title[1]);
    titles.set(t, [...(titles.get(t) ?? []), page]);
  }

  const desc = els.find(
    (e) => e.name === "meta" && e.attrs.get("name") === "description",
  );
  if (!desc || !desc.attrs.get("content")?.trim())
    fail(page, "missing meta description");

  // Counts markers in text and attributes (e.g. alt, title) of the rendered page.
  const todos = (content.match(/TODO\(client\)/g) ?? []).length;
  if (todos) {
    todoCounts.push([page, todos]);
    if (LAUNCH) fail(page, `${todos} TODO(client) marker(s) in launch build`);
  }

  for (const a of anchors) {
    if (a.href.startsWith("/") && !a.href.startsWith("//"))
      links.push([page, a.href]);
  }
}

for (const [t, pages] of titles) {
  if (pages.length > 1) fail(pages.join(", "), `duplicate <title> "${t}"`);
}

function resolves(href) {
  const path = decodeURIComponent(href.split(/[?#]/)[0]);
  if (path === "/" || path === "") return existsSync(join(DIST, "index.html"));
  const rel = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return [rel, `${rel}.html`, join(rel, "index.html")].some(
    (p) => existsSync(join(DIST, p)) && statSync(join(DIST, p)).isFile(),
  );
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();

// url() inside referenced local stylesheets (fonts, background images).
for (const css of cssFiles) {
  const file = join(DIST, css);
  if (!isFile(file)) continue; // reported below as a missing asset
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
    const ref = m[2].trim();
    if (/^(data:|#|https?:\/\/(?!www\.pecoindustrial\.co\.uk))/i.test(ref))
      continue;
    const p = decodeURIComponent(new URL(ref, ORIGIN + css).pathname);
    if (!assets.has(p)) assets.set(p, `${css} (url())`);
  }
}

for (const [p, from] of assets) {
  if (!isFile(join(DIST, p))) fail(from, `missing asset ${p}`);
}

let checkedLinks = 0;
if (!SKIP_LINKS) {
  const seen = new Set();
  for (const [page, href] of links) {
    const key = `${page} ${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checkedLinks++;
    if (!resolves(href)) fail(page, `broken internal link ${href}`);
  }
}

console.log(
  `check-dist: ${files.length} page(s) checked, ${assets.size} local asset(s) checked${SKIP_LINKS ? ", internal links skipped (--skip-links)" : `, ${checkedLinks} internal link(s) checked`}${LAUNCH ? ", LAUNCH mode" : ""}`,
);
if (todoCounts.length) {
  console.log("TODO(client) markers per page:");
  for (const [page, n] of todoCounts) console.log(`  ${page}: ${n}`);
}
if (warnings.length) {
  console.warn(`check-dist: ${warnings.length} warning(s):`);
  for (const w of [...new Set(warnings)]) console.warn(`  ~ ${w}`);
}

if (failures.length) {
  console.error(`\ncheck-dist: ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("check-dist: OK");
