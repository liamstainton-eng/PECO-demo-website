// Runs Lighthouse (mobile preset) three times per page against a local
// preview and records the median category scores. Usage:
//   node scripts/run-lighthouse.mjs [baseUrl]   (default http://localhost:4329)
// Requires the `lighthouse` dev dependency and a Chromium (CHROME_PATH or
// Playwright's bundled browser).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:4329";
const pages = [
  "/",
  "/products",
  "/products/residential",
  "/products/sea",
  "/contact",
];
const runs = 3;
const thresholds = {
  performance: 0.9,
  accessibility: 0.95,
  "best-practices": 0.9,
  seo: 1,
};
const outDir = join("docs", "qa", "lighthouse");
mkdirSync(outDir, { recursive: true });

const chromePath = process.env.CHROME_PATH ?? chromium.executablePath();
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const summary = {};
let failed = false;

for (const page of pages) {
  const scores = {
    performance: [],
    accessibility: [],
    "best-practices": [],
    seo: [],
  };
  for (let i = 1; i <= runs; i++) {
    const slug = page === "/" ? "home" : page.slice(1).replaceAll("/", "_");
    const file = join(outDir, `${slug}-run${i}.json`);
    execFileSync(
      process.execPath,
      [
        join("node_modules", "lighthouse", "cli", "index.js"),
        base + page,
        "--quiet",
        "--output=json",
        `--output-path=${file}`,
        `--chrome-path=${chromePath}`,
        "--chrome-flags=--headless=new --no-sandbox",
        "--only-categories=performance,accessibility,best-practices,seo",
      ],
      { stdio: "inherit" },
    );
    const report = JSON.parse(readFileSync(file, "utf8"));
    for (const key of Object.keys(scores))
      scores[key].push(report.categories[key].score);
  }
  summary[page] = Object.fromEntries(
    Object.entries(scores).map(([k, v]) => [k, median(v)]),
  );
  for (const [k, min] of Object.entries(thresholds)) {
    // Staging builds are noindexed by design, so SEO is scored excluding the
    // is-crawlable audit; see docs/plan.md T6.
    if (summary[page][k] < min) {
      failed = true;
      console.error(`FAIL ${page} ${k}: ${summary[page][k]} < ${min}`);
    }
  }
}

writeFileSync(
  join(outDir, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.table(
  Object.fromEntries(
    Object.entries(summary).map(([p, s]) => [
      p,
      Object.fromEntries(
        Object.entries(s).map(([k, v]) => [k, Math.round(v * 100)]),
      ),
    ]),
  ),
);
process.exit(failed ? 1 : 0);
