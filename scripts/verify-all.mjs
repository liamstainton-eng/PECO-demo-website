#!/usr/bin/env node
// Full release verification (npm run verify:all). Stops at the first failure.
//
//   1. fresh build: `npm run build` (prebuild launch gate when LAUNCH=1,
//      postbuild _headers) into dist/
//   2. fast checks: astro check, unit tests, product data, dist HTML/assets,
//      contrast, strict JSON-LD, static redirects
//   3. `npm run e2e` (Playwright + axe; starts its own preview on port 4329)
//   4. linkinator crawl of an `astro preview` on a free port, with mailto:, tel:
//      and external URLs skipped; the preview is stopped afterwards
// Lighthouse is separate (npm run qa:lighthouse) because it takes minutes.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startPreview } from "./lib/preview.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const LINKINATOR = fileURLToPath(
  new URL("../node_modules/linkinator/build/src/cli.js", import.meta.url),
);

function run(label, cmd, args, opts = {}) {
  console.log(`\n=== verify:all: ${label} ===`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    // npm.cmd needs a shell on Windows; arguments here are fixed strings.
    shell: cmd === NPM && process.platform === "win32",
    ...opts,
  });
  if (res.status !== 0) {
    console.error(
      `\nverify:all: FAILED at "${label}" (exit ${res.status ?? res.signal ?? res.error?.message})`,
    );
    process.exit(res.status || 1);
  }
}

const node = (label, script, ...args) =>
  run(label, process.execPath, [script, ...args]);

// 1. Fresh build (no stale dist/ files can satisfy a check).
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
run("build", NPM, ["run", "build"]);

// 2. Fast checks.
run("astro check", NPM, ["run", "check"]);
run("unit tests", NPM, ["run", "test"]);
node("product data", "scripts/check-products.mjs");
node("dist HTML and assets", "scripts/check-dist.mjs");
node("contrast", "scripts/check-contrast.mjs");
node("JSON-LD (strict)", "scripts/check-jsonld.mjs", "--strict");
node("redirects (static)", "scripts/check-redirects.mjs", "--static");

// 3. Browser tests.
run("e2e (Playwright + axe)", NPM, ["run", "e2e"]);

// 4. Link crawl against a real server.
console.log("\n=== verify:all: linkinator crawl ===");
const preview = await startPreview();
let status = 1;
try {
  const res = spawnSync(
    process.execPath,
    [
      LINKINATOR,
      preview.url,
      "--recurse",
      "--check-css",
      "--skip",
      "^(mailto|tel):",
      "--skip",
      "^https?://(?!127\\.0\\.0\\.1[:/])",
      "--timeout",
      "15000",
      "--verbosity",
      "error",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  status = res.status ?? 1;
} finally {
  await preview.stop();
}
if (status !== 0) {
  console.error('\nverify:all: FAILED at "linkinator crawl"');
  process.exit(status);
}
console.log("\nverify:all: PASS");
