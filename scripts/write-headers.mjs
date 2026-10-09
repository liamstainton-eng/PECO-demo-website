// Postbuild: writes <dist>/_headers for Cloudflare Pages.
//
//   node scripts/write-headers.mjs [--dir <path>]   (default dist)
//
// LAUNCH=1 is set only in the Cloudflare production environment. Every other
// build (local, preview) is noindexed. The *.pages.dev aliases are always
// noindexed, both the project alias (https://:project.pages.dev) and the
// per-deployment / branch aliases (https://:version.:project.pages.dev), so only
// the real domain gets indexed. LAUNCH=1 also adds HSTS (the real domain is
// HTTPS-only; preview builds never send it).
import { writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const dirIdx = args.indexOf("--dir");
const dist = resolve(dirIdx >= 0 ? args[dirIdx + 1] : "dist");
if (!existsSync(dist)) {
  console.error(`write-headers: ${dist} not found, run astro build first`);
  process.exit(1);
}

const launch = process.env.LAUNCH === "1";

const security = [
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "X-Frame-Options: DENY",
  "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  ...(launch
    ? ["Strict-Transport-Security: max-age=31536000; includeSubDomains"]
    : []),
];

const blocks = [
  ["/*", [...security, ...(launch ? [] : ["X-Robots-Tag: noindex"])]],
  ["https://:project.pages.dev/*", ["X-Robots-Tag: noindex"]],
  ["https://:version.:project.pages.dev/*", ["X-Robots-Tag: noindex"]],
  ["/_astro/*", ["Cache-Control: public, max-age=31536000, immutable"]],
];

const out =
  blocks
    .map(([path, lines]) => [path, ...lines.map((l) => `  ${l}`)].join("\n"))
    .join("\n\n") + "\n";

writeFileSync(join(dist, "_headers"), out);
console.log(
  `write-headers: ${join(dist, "_headers")} written (${launch ? "production, HSTS" : "staging, noindex"})`,
);
