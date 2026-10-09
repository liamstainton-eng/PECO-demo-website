#!/usr/bin/env node
// Sanity checks for product data (npm run verify:data). No Astro dependency:
// reuses src/lib/csv.ts, src/lib/dims.ts and src/content/slugs.ts through Node's
// TypeScript type stripping, and the pure rules in scripts/lib/product-rules.mjs.
//
// Every problem is fatal:
// - unknown slugs, missing files, broken references, wrong attenuation;
// - status/file/verification/expectedRows/raw2Columns inconsistencies;
// - CSV parse/header/cell errors (the loader rejects zero, invalid fractions and
//   raw2 outside the product's raw2Columns);
// - duplicate or unparseable part numbers, non-positive dimensions, counts, weights;
// - a row count different from the product's expectedRows;
// - sanity anomalies (mm vs in, lbs vs kg, bore order, part-number sequence per
//   series) unless the row note carries the matching structured token, e.g.
//   `anomaly:mm-mismatch:Hmax`. A token excuses only its own rule and column; unknown,
//   malformed or unused tokens are errors too. Fixture tables must mark every row
//   `anomaly:fixture`; other tables must not use it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSizesCsv } from "../src/lib/csv.ts";
import { CATEGORY_SLUGS, PRODUCT_SLUGS } from "../src/content/slugs.ts";
import {
  duplicatePartNos,
  explainAnomalies,
  hardProblems,
  newSequenceState,
  parseAnomalies,
  rowAnomalies,
} from "./lib/product-rules.mjs";

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
const fail = (msg) => errors.push(msg);
let excused = 0;

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
  if (p.sizesStatus === "verified") {
    if (!p.verification)
      fail(`${where}: sizesStatus "verified" needs a verification record`);
    if (p.expectedRows === undefined)
      fail(`${where}: sizesStatus "verified" needs expectedRows`);
  }
  if (
    p.expectedRows !== undefined &&
    !(Number.isInteger(p.expectedRows) && p.expectedRows > 0)
  )
    fail(`${where}: expectedRows must be a positive whole number`);
  for (const key of p.raw2Columns ?? []) {
    if (!(p.columns ?? []).some((c) => c.key === key && c.kind === "pair"))
      fail(`${where}: raw2Columns "${key}" is not a pair column`);
  }
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
      { raw2Columns: p.raw2Columns ?? [] },
    );
  } catch (e) {
    fail(e.message);
    continue;
  }
  rowCount += rows.length;

  if (p.expectedRows !== undefined && rows.length !== p.expectedRows)
    fail(
      `${where}: ${rows.length} row(s), products/${id}.json expectedRows is ${p.expectedRows}`,
    );
  for (const d of duplicatePartNos(rows))
    fail(`${where} ${d}: duplicate part number`);

  const keys = p.columns.map((c) => c.key);
  const isFixture = p.sizesStatus === "fixture";
  const state = newSequenceState();
  for (const row of rows) {
    const at = `${where} ${row.partNo}`;
    for (const h of hardProblems(row, p.columns)) fail(`${at}: ${h}`);

    const { tokens, errors: tokenErrors } = parseAnomalies(row.note, keys);
    for (const e of tokenErrors) fail(`${at}: ${e}`);
    const fixtureToken = tokens.some((t) => t.rule === "fixture");
    if (isFixture && !fixtureToken)
      fail(`${at}: fixture table row must carry anomaly:fixture`);
    if (!isFixture && fixtureToken)
      fail(
        `${at}: anomaly:fixture in a table whose sizesStatus is "${p.sizesStatus}"`,
      );

    const anomalies = rowAnomalies(row, p.columns, state);
    const { unexplained, unused } = explainAnomalies(anomalies, tokens);
    excused += anomalies.length - unexplained.length;
    for (const u of unexplained)
      fail(`${at}: ${u} (fix the data or add the matching anomaly: token)`);
    for (const u of unused) fail(`${at}: ${u} excuses nothing; remove it`);
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

if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  console.error(`check-products: ${errors.length} error(s)`);
  process.exit(1);
}
console.log(
  `check-products: OK (${products.size} products, ${csvIds.length} size table(s), ${rowCount} rows, ${categoryIds.length} categories, ${excused} anomaly(ies) excused by token)`,
);
