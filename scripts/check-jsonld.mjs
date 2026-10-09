#!/usr/bin/env node
// Post-build JSON-LD checks over every HTML page in a dist dir. No dependencies.
//
//   node scripts/check-jsonld.mjs [--dir <path>] [--strict]
//
// Every <script type="application/ld+json"> must parse. Every page needs an
// Organization and a LocalBusiness; product pages a Product and BreadcrumbList;
// category pages a BreadcrumbList. No offers/aggregateRating anywhere; every
// url/item value is an absolute https://www.pecoindustrial.co.uk URL.
// Missing product/category pages are warnings unless --strict.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep, resolve } from "node:path";
import { CATEGORY_SLUGS, PRODUCT_SLUGS } from "../src/content/slugs.ts";

const args = process.argv.slice(2);
const dirIdx = args.indexOf("--dir");
const DIST = resolve(dirIdx >= 0 ? args[dirIdx + 1] : "dist");
const STRICT = args.includes("--strict");
const ORIGIN = "https://www.pecoindustrial.co.uk";
// Frozen slugs from src/content/slugs.ts (Node type stripping), not a copy.
const PRODUCTS = PRODUCT_SLUGS;
const CATEGORIES = CATEGORY_SLUGS;
const FORBIDDEN = ["offers", "aggregateRating"];

if (!existsSync(DIST)) {
  console.error(`check-jsonld: ${DIST} not found, run a build first`);
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });

const pathOf = (file) => {
  const p =
    "/" +
    relative(DIST, file)
      .split(sep)
      .join("/")
      .replace(/\.html$/, "");
  return p.replace(/\/index$/, "") || "/";
};

const failures = [];
const warnings = [];
const fail = (page, msg) => failures.push(`${page}: ${msg}`);

const types = (node) => [].concat(node?.["@type"] ?? []);

/** Flatten top-level objects, arrays and @graph into a list of nodes. */
const topNodes = (data) =>
  (Array.isArray(data) ? data : [data]).flatMap((n) =>
    n && Array.isArray(n["@graph"]) ? n["@graph"] : [n],
  );

/** Walk any value; call fn(key, value) for every property. */
function visit(value, fn) {
  if (Array.isArray(value)) return value.forEach((v) => visit(v, fn));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      fn(k, v);
      visit(v, fn);
    }
  }
}

const pages = walk(DIST).filter((f) => f.endsWith(".html"));
const seen = new Map();
const SCRIPT =
  /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

for (const file of pages) {
  const page = pathOf(file);
  const html = readFileSync(file, "utf8");
  const nodes = [];
  let count = 0;
  for (const m of html.matchAll(SCRIPT)) {
    count++;
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch (e) {
      fail(page, `invalid JSON-LD (${e.message})`);
      continue;
    }
    nodes.push(...topNodes(data));
    visit(data, (k, v) => {
      if (FORBIDDEN.includes(k)) fail(page, `forbidden property "${k}"`);
      if ((k === "url" || k === "item") && typeof v === "string") {
        if (v !== ORIGIN && !v.startsWith(ORIGIN + "/"))
          fail(page, `${k} not an absolute site URL: ${v}`);
      }
    });
  }
  const found = new Set(nodes.flatMap(types));
  seen.set(page, { count, found });

  for (const t of ["Organization", "LocalBusiness"]) {
    if (!found.has(t)) fail(page, `missing ${t}`);
  }
}

const requirePage = (path, needed) => {
  const entry = seen.get(path);
  if (!entry) {
    (STRICT ? failures : warnings).push(`${path}: page not found in ${DIST}`);
    return;
  }
  for (const t of needed) if (!entry.found.has(t)) fail(path, `missing ${t}`);
};

for (const slug of PRODUCTS)
  requirePage(`/products/${slug}`, ["Product", "BreadcrumbList"]);
for (const slug of CATEGORIES)
  requirePage(`/products/${slug}`, ["BreadcrumbList"]);

console.log(`check-jsonld: ${pages.length} page(s) in ${DIST}`);
for (const [page, { count, found }] of [...seen].sort()) {
  console.log(
    `  ${page}  scripts=${count}  types=${[...found].sort().join(",") || "-"}`,
  );
}
if (warnings.length) {
  console.warn(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.warn(`  WARN ${w}`);
}
if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log("\ncheck-jsonld: OK");
