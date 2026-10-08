#!/usr/bin/env node
// Sanity checks for product data (npm run verify:data). No Astro dependency:
// reuses src/lib/csv.ts and src/lib/dims.ts through Node's TypeScript type stripping.
//
// Hard failures: unknown slugs, missing files, broken references, wrong attenuation,
// CSV parse/header errors, duplicate part numbers.
// Row sanity failures (mm vs in, lbs vs kg, bore order) are allowed only when the row
// has a non-empty `note` explaining them; otherwise they fail too.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSizesCsv } from "../src/lib/csv.ts";
import { lbsMatchesKg, mmMatchesInches, parseInches } from "../src/lib/dims.ts";
import { CATEGORY_SLUGS, PRODUCT_SLUGS } from "../src/content/slugs.ts";

const content = fileURLToPath(new URL("../src/content/", import.meta.url));
const dir = (name) => `${content}${name}/`;

// Attenuation as printed on the datasheet or the old product page copy (plan T2 AC).
const ATTENUATION = {
  sea: 24,
  se20: 18,
  se30: 24,
  "se30-abs": null,
  se40: 28,
  se50: 32,
  sls: 15,
  sa1: 18,
  sa2: 24,
};

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);

const listIds = (name, ext) =>
  existsSync(dir(name))
    ? readdirSync(dir(name))
        .filter((f) => f.endsWith(ext))
        .map((f) => f.slice(0, -ext.length))
        .sort()
    : [];

// Categories
const categoryIds = listIds("categories", ".md");
for (const id of categoryIds)
  if (!CATEGORY_SLUGS.includes(id))
    fail(`categories/${id}.md: not in CATEGORY_SLUGS`);
for (const slug of CATEGORY_SLUGS)
  if (!categoryIds.includes(slug)) fail(`categories/${slug}.md: missing`);

// Products
const productIds = listIds("products", ".json");
const csvIds = listIds("sizes", ".csv");
for (const slug of PRODUCT_SLUGS)
  if (!productIds.includes(slug)) fail(`products/${slug}.json: missing`);

const products = new Map();
for (const id of productIds) {
  const where = `products/${id}.json`;
  if (!PRODUCT_SLUGS.includes(id)) {
    fail(`${where}: "${id}" is not in PRODUCT_SLUGS`);
    continue;
  }
  let p;
  try {
    p = JSON.parse(readFileSync(`${dir("products")}${id}.json`, "utf-8"));
  } catch (e) {
    fail(`${where}: ${e.message}`);
    continue;
  }
  products.set(id, p);

  if (!categoryIds.includes(p.category))
    fail(`${where}: category "${p.category}" does not resolve`);
  for (const r of p.related ?? []) {
    if (!PRODUCT_SLUGS.includes(r))
      fail(`${where}: related "${r}" does not resolve`);
    if (r === id) fail(`${where}: related lists itself`);
  }
  if (p.attenuationDbA !== ATTENUATION[id]) {
    fail(
      `${where}: attenuationDbA ${p.attenuationDbA}, expected ${ATTENUATION[id]}`,
    );
  }
  if ((p.attenuationDbA === null) !== (p.attenuationSource === "todo")) {
    fail(
      `${where}: attenuationSource "${p.attenuationSource}" does not match attenuationDbA ${p.attenuationDbA}`,
    );
  }

  const hasCsv = csvIds.includes(id);
  if (p.sizes !== null && p.sizes !== id)
    fail(`${where}: sizes must be "${id}" or null`);
  if (p.sizes === id && !hasCsv)
    fail(`${where}: sizes references sizes/${id}.csv, which does not exist`);
  if (p.sizes === null && hasCsv)
    fail(`${where}: sizes/${id}.csv exists but sizes is null`);
  const needsCsv = p.sizesStatus === "verified" || p.sizesStatus === "fixture";
  if (needsCsv !== (p.sizes !== null))
    fail(
      `${where}: sizesStatus "${p.sizesStatus}" inconsistent with sizes ${p.sizes}`,
    );
  if (p.sizesStatus !== "none" && !Array.isArray(p.columns))
    fail(`${where}: sizesStatus "${p.sizesStatus}" needs columns`);
}

// Size tables
let rowCount = 0;
for (const id of csvIds) {
  const where = `sizes/${id}.csv`;
  const p = products.get(id);
  if (!p) {
    fail(`${where}: no matching products/${id}.json`);
    continue;
  }
  if (!Array.isArray(p.columns)) {
    fail(`${where}: products/${id}.json has no columns`);
    continue;
  }
  let rows;
  try {
    rows = loadSizesCsv(
      readFileSync(`${dir("sizes")}${id}.csv`, "utf-8"),
      p.columns,
      where,
    );
  } catch (e) {
    fail(e.message);
    continue;
  }
  rowCount += rows.length;

  const seen = new Set();
  let prev = null;
  for (const row of rows) {
    if (seen.has(row.partNo))
      fail(`${where} ${row.partNo}: duplicate part number`);
    seen.add(row.partNo);

    for (const c of p.columns) {
      if (!(c.key in row.dims))
        fail(`${where} ${row.partNo}: column ${c.key} missing`);
    }

    const problems = [];
    const pairs = [
      ["bore", row.bore],
      ...p.columns
        .filter((c) => c.kind === "pair")
        .map((c) => [c.key, row.dims[c.key]]),
    ];
    for (const [key, cell] of pairs) {
      if (cell.kind !== "pair" || cell.mm === null) continue; // skips na, todo and raw2
      const inches = parseInches(cell.in);
      if (inches === null) problems.push(`${key}: cannot parse "${cell.in}"`);
      else if (!mmMatchesInches(inches, cell.mm)) {
        problems.push(
          `${key}: ${cell.in} in vs ${cell.mm} mm (expected ~${(inches * 25.4).toFixed(1)})`,
        );
      }
    }
    const { lbs, kg } = row.wt;
    if (
      lbs.kind === "num" &&
      kg.kind === "num" &&
      !lbsMatchesKg(lbs.value, kg.value)
    ) {
      problems.push(
        `weight: ${lbs.value} lbs vs ${kg.value} kg (expected ~${(kg.value * 2.2046).toFixed(1)} lbs)`,
      );
    }
    const bore = row.bore.kind === "pair" ? parseInches(row.bore.in) : null;
    if (bore !== null && prev !== null) {
      if (
        bore < prev.bore ||
        (bore === prev.bore && row.markers === prev.markers)
      ) {
        problems.push(
          `bore ${row.bore.in} not after ${prev.partNo} (${prev.bore}${prev.markers ? ` ${prev.markers}` : ""})`,
        );
      }
    }
    if (bore !== null)
      prev = { bore, markers: row.markers, partNo: row.partNo };

    if (problems.length > 0) {
      const msg = `${where} ${row.partNo}: ${problems.join("; ")}`;
      if (row.note.trim() === "") fail(`${msg} (add a note explaining it)`);
      else warnings.push(`${msg} [note: ${row.note}]`);
    }
  }
}

// Projects
const projectsFile = `${dir("projects")}projects.json`;
if (existsSync(projectsFile)) {
  const projects = JSON.parse(readFileSync(projectsFile, "utf-8"));
  const ids = new Set();
  for (const pr of projects) {
    if (ids.has(pr.id)) fail(`projects.json: duplicate id "${pr.id}"`);
    ids.add(pr.id);
    if (pr.product !== null && !PRODUCT_SLUGS.includes(pr.product)) {
      fail(`projects.json ${pr.id}: product "${pr.product}" does not resolve`);
    }
  }
}

for (const w of warnings) console.warn(`warn: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`check-products: ${errors.length} error(s)`);
  process.exit(1);
}
console.log(
  `check-products: OK (${products.size} products, ${csvIds.length} size table(s), ${rowCount} rows, ${categoryIds.length} categories, ${warnings.length} noted anomalies)`,
);
