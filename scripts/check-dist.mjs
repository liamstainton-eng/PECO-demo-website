#!/usr/bin/env node
// Post-build checks over every HTML page in dist/. No dependencies.
//
//   node scripts/check-dist.mjs [--skip-links]
//
// Per page: tel link, "Get a quote" link (M1 mailto or M2 /quote), exactly one
// <h1>, alt on every <img>, banned strings absent, <title> present and unique,
// meta description present. Then internal href existence (unless --skip-links).
// LAUNCH=1: any "TODO(client)" fails. Otherwise TODO(client) counts are reported.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const DIST = join(process.cwd(), "dist");
const SKIP_LINKS = process.argv.includes("--skip-links");
const LAUNCH = process.env.LAUNCH === "1";

const TEL_HREF = 'href="tel:01513430330"';
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

if (!existsSync(DIST)) {
  console.error("check-dist: dist/ not found, run `npm run build` first");
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
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const stripTags = (s) =>
  decode(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const attr = (attrs, name) => {
  const m = attrs.match(
    new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : undefined;
};

const files = walk(DIST).filter((f) => f.endsWith(".html"));
const pageOf = (f) => "/" + relative(DIST, f).split(sep).join("/");

const failures = [];
const fail = (page, msg) => failures.push(`${page}: ${msg}`);
const titles = new Map();
const todoCounts = [];
const links = [];

for (const file of files) {
  const page = pageOf(file);
  const html = readFileSync(file, "utf8");
  // Drop <script>/<style> bodies so code never counts as content.
  const content = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  if (!html.includes(TEL_HREF)) fail(page, `missing ${TEL_HREF}`);

  const anchors = [...content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(
    (m) => ({
      href: attr(m[1], "href") ?? "",
      text: stripTags(m[2]).toLowerCase(),
    }),
  );
  const quote = anchors.filter((a) => a.text === QUOTE_TEXT);
  if (quote.length === 0) fail(page, 'no "Get a quote" link');
  for (const q of quote) {
    if (!(
      q.href.startsWith(QUOTE_MAILTO) ||
      q.href === QUOTE_PATH ||
      q.href.startsWith(`${QUOTE_PATH}?`)
    )) {
      fail(page, `"Get a quote" link has unexpected href "${q.href}"`);
    }
  }

  const h1s = (content.match(/<h1[\s>]/gi) ?? []).length;
  if (h1s !== 1) fail(page, `expected exactly one <h1>, found ${h1s}`);

  for (const m of content.matchAll(/<img\b([^>]*)>/gi)) {
    if (attr(m[1], "alt") === undefined)
      fail(page, `<img> without alt: ${m[0].slice(0, 120)}`);
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

  const desc = [...content.matchAll(/<meta\b([^>]*)>/gi)].find(
    (m) => attr(m[1], "name") === "description",
  );
  if (!desc || !attr(desc[1], "content")?.trim())
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
  `check-dist: ${files.length} page(s) checked${SKIP_LINKS ? ", internal links skipped (--skip-links)" : `, ${checkedLinks} internal link(s) checked`}${LAUNCH ? ", LAUNCH mode" : ""}`,
);
if (todoCounts.length) {
  console.log("TODO(client) markers per page:");
  for (const [page, n] of todoCounts) console.log(`  ${page}: ${n}`);
}

if (failures.length) {
  console.error(`\ncheck-dist: ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("check-dist: OK");
