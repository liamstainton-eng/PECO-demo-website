#!/usr/bin/env node
// Source-level launch gate (npm run verify:launch; runs automatically before
// `npm run build` when LAUNCH=1, via the prebuild script).
//
//   node scripts/check-launch.mjs [--if-launch]
//
// Reads source, never rendered HTML, so nothing the templates hide or rewrite in
// launch mode can slip through. Fails (exit 1) listing every blocker:
// - a category or legal entry without `approved: true`;
// - a product with sizesStatus "fixture" or "pending-transcription";
// - a shipped size table without a client-approved verification record or whose
//   CSV row count differs from expectedRows;
// - sizesStatus "none" without an explicit launchException;
// - analytics provider configured with an empty token (legal pages claim analytics);
// - indicative prices set while the pricing basis still contains TODO(client).
// --if-launch: do nothing unless LAUNCH=1 (used by prebuild).
// Rules live in scripts/lib/launch-rules.mjs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { loadSizesCsv } from "../src/lib/csv.ts";
import { launchBlockers } from "./lib/launch-rules.mjs";

if (process.argv.includes("--if-launch") && process.env.LAUNCH !== "1") {
  process.exit(0);
}

const src = fileURLToPath(new URL("../src/", import.meta.url));
const read = (rel) => readFileSync(`${src}${rel}`, "utf-8");
const list = (rel, ext) =>
  readdirSync(`${src}${rel}`)
    .filter((f) => f.endsWith(ext))
    .sort();

const problems = [];

function frontmatter(rel) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(read(rel));
  if (!m) {
    problems.push(`${rel}: no YAML frontmatter`);
    return {};
  }
  return parseYaml(m[1]) ?? {};
}

const approvals = [];
for (const collection of ["categories", "legal"]) {
  for (const f of list(`content/${collection}`, ".md")) {
    const fm = frontmatter(`content/${collection}/${f}`);
    approvals.push({
      collection,
      id: f.slice(0, -3),
      approved: fm.approved,
    });
  }
}

const products = [];
for (const f of list("content/products", ".json")) {
  const id = f.slice(0, -5);
  const data = JSON.parse(read(`content/products/${f}`));
  let csvRows = null;
  const csv = `content/sizes/${id}.csv`;
  if (existsSync(`${src}${csv}`) && Array.isArray(data.columns)) {
    try {
      csvRows = loadSizesCsv(read(csv), data.columns, csv, {
        raw2Columns: data.raw2Columns ?? [],
      }).length;
    } catch (e) {
      problems.push(e.message);
    }
  }
  products.push({ id, data, csvRows });
}

const config = parseYaml(read("config.yaml"));
const pricing = JSON.parse(read("data/pricing.json"));

const blockers = [
  ...problems,
  ...launchBlockers({ approvals, products, config, pricing }),
];

if (blockers.length > 0) {
  console.error(`check-launch: ${blockers.length} launch blocker(s):`);
  for (const b of blockers) console.error(`  - ${b}`);
  process.exit(1);
}
console.log(
  `check-launch: OK (${approvals.length} approved entries, ${products.length} products)`,
);
