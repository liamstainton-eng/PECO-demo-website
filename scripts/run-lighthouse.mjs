// Runs Lighthouse (mobile preset) three times per page and records the median
// category scores, with the identity of the build measured, in
// docs/qa/lighthouse/summary.json. Fails (exit 1) below the T6 thresholds.
//
//   node scripts/run-lighthouse.mjs [baseUrl] [--dir <path>]
//
// Without baseUrl it serves <dir> (default dist) with `astro preview` on a free
// port and stops it afterwards. `npm run qa:lighthouse` builds first, so the
// numbers always belong to the current source. The build identity is the git
// HEAD SHA (plus whether the tree had uncommitted changes) and the build
// timestamp (mtime of <dir>/index.html).
// Requires the `lighthouse` dev dependency and a Chromium (CHROME_PATH or
// Playwright's bundled browser).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { startPreview } from "./lib/preview.mjs";

const args = process.argv.slice(2);
const dirIdx = args.indexOf("--dir");
const distArg = dirIdx >= 0 ? args[dirIdx + 1] : "dist";
const positional = args.filter(
  (a, i) => !a.startsWith("--") && (dirIdx < 0 || i !== dirIdx + 1),
);
const pages = [
  "/",
  "/products",
  "/products/residential",
  "/products/sea",
  "/products/sa1",
  "/projects",
  "/pricing",
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

const git = (...a) => {
  try {
    return execFileSync("git", a, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
const builtAt = (() => {
  try {
    return statSync(join(resolve(distArg), "index.html")).mtime.toISOString();
  } catch {
    return null;
  }
})();
const build = {
  gitSha: git("rev-parse", "HEAD"),
  gitDirty: (git("status", "--porcelain") ?? "") !== "",
  builtAt,
  dir: distArg,
  launch: process.env.LAUNCH === "1",
  measuredAt: new Date().toISOString(),
};
if (!build.builtAt) {
  console.error(`run-lighthouse: ${distArg}/index.html not found, build first`);
  process.exit(1);
}

const preview = positional[0] ? null : await startPreview({ outDir: distArg });
const base = (positional[0] ?? preview.url).replace(/\/+$/, "");
build.baseUrl = base;

const chromePath = process.env.CHROME_PATH ?? chromium.executablePath();
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const summary = {};
const failures = [];

try {
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
      if (summary[page][k] < min) {
        failures.push(`${page} ${k}: ${summary[page][k]} < ${min}`);
        console.error(`FAIL ${page} ${k}: ${summary[page][k]} < ${min}`);
      }
    }
  }
} finally {
  await preview?.stop();
}

writeFileSync(
  join(outDir, "summary.json"),
  JSON.stringify(
    {
      build,
      runs,
      thresholds,
      pass: failures.length === 0,
      failures,
      pages: summary,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Build ${build.gitSha ?? "(no git)"}${build.gitDirty ? " (uncommitted changes)" : ""}, built ${build.builtAt}`,
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
process.exit(failures.length ? 1 : 0);
