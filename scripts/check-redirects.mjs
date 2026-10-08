// T5d: validate docs/old-urls.csv and the generated public/_redirects.
//
// Usage: node scripts/check-redirects.mjs [baseUrl] [--static]
//   (always)  CSV integrity: header, valid action, redirect rows have a target,
//             gone rows have none, every target is a frozen new-site route.
//   --static  every redirect row appears in public/_redirects with the same
//             target and 301; no _redirects source equals a frozen route.
//   baseUrl   live mode: redirect rows must answer 301 with Location path ==
//             target and the target must be 200; gone rows must be 404.
//             Also probes `<product url>?rCH=2` and `/index.php?option=com_content`
//             and reports the actual behaviour (informational).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FROZEN_ROUTES, parseCsv, redirectSource } from "./discover-urls.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = join(ROOT, "docs", "old-urls.csv");
const REDIRECTS_PATH = join(ROOT, "public", "_redirects");
const EXPECTED_HEADER = ["url", "action", "target", "source", "note"];

const argv = process.argv.slice(2);
const staticMode = argv.includes("--static");
const baseUrl = argv.find((a) => !a.startsWith("--"))?.replace(/\/+$/, "");

const frozen = new Set(FROZEN_ROUTES);
const failures = [];
const fail = (msg) => failures.push(msg);

// ------------------------------------------------------------------ CSV
if (!existsSync(CSV_PATH)) {
  console.error(`Missing ${CSV_PATH}`);
  process.exit(1);
}
const [head, ...rawRows] = parseCsv(readFileSync(CSV_PATH, "utf8"));
if (
  !head ||
  EXPECTED_HEADER.some((h, i) => head[i] !== h) ||
  head.length !== EXPECTED_HEADER.length
) {
  fail(
    `CSV header must be ${EXPECTED_HEADER.join(",")}, got ${head?.join(",")}`,
  );
}
const rows = rawRows.map((r, i) => ({
  line: i + 2,
  url: r[0] ?? "",
  action: (r[1] ?? "").trim(),
  target: (r[2] ?? "").trim(),
  source: r[3] ?? "",
  note: r[4] ?? "",
  cols: r.length,
}));

const seenUrls = new Set();
for (const r of rows) {
  const where = `line ${r.line} (${r.url})`;
  if (r.cols !== EXPECTED_HEADER.length)
    fail(`${where}: expected 5 columns, got ${r.cols}`);
  if (!r.url.startsWith("/")) fail(`${where}: url must start with /`);
  if (seenUrls.has(r.url)) fail(`${where}: duplicate url`);
  seenUrls.add(r.url);
  if (r.action !== "redirect" && r.action !== "gone") {
    fail(`${where}: invalid or empty action "${r.action}"`);
    continue;
  }
  if (r.action === "redirect") {
    if (!r.target) fail(`${where}: redirect row has no target`);
    else if (!frozen.has(r.target))
      fail(`${where}: target ${r.target} is not a frozen route`);
  } else if (r.target) {
    fail(`${where}: gone row must have an empty target`);
  }
}

const redirectRows = rows.filter((r) => r.action === "redirect");
const goneRows = rows.filter((r) => r.action === "gone");

// --------------------------------------------------------------- static
let ruleCount = 0;
if (staticMode) {
  if (!existsSync(REDIRECTS_PATH)) {
    fail(`Missing ${REDIRECTS_PATH}`);
  } else {
    const rules = new Map();
    for (const [n, line] of readFileSync(REDIRECTS_PATH, "utf8")
      .split(/\r?\n/)
      .entries()) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const parts = t.split(/\s+/);
      if (parts.length !== 3 || parts[2] !== "301") {
        fail(
          `_redirects line ${n + 1}: expected "<source> <target> 301", got "${t}"`,
        );
        continue;
      }
      const [src, tgt] = parts;
      if (src.includes("*") || src.includes(":") || tgt.includes("*"))
        fail(`_redirects line ${n + 1}: splat/placeholder not allowed: ${t}`);
      if (frozen.has(src))
        fail(
          `_redirects line ${n + 1}: source ${src} equals a frozen route (redirect loop)`,
        );
      if (!frozen.has(tgt))
        fail(`_redirects line ${n + 1}: target ${tgt} is not a frozen route`);
      if (rules.has(src))
        fail(`_redirects line ${n + 1}: duplicate source ${src}`);
      rules.set(src, tgt);
    }
    ruleCount = rules.size;
    if (ruleCount >= 2000)
      fail(`_redirects has ${ruleCount} rules (limit 2,000)`);
    for (const r of redirectRows) {
      const src = redirectSource(r.url);
      if (frozen.has(src)) {
        fail(
          `line ${r.line} (${r.url}): redirect row source equals a frozen route (would loop)`,
        );
        continue;
      }
      if (!rules.has(src))
        fail(`line ${r.line} (${r.url}): missing from public/_redirects`);
      else if (rules.get(src) !== r.target)
        fail(
          `line ${r.line} (${r.url}): _redirects target ${rules.get(src)} != CSV target ${r.target}`,
        );
    }
    const expectedSources = new Set(
      redirectRows.map((r) => redirectSource(r.url)),
    );
    for (const src of rules.keys())
      if (!expectedSources.has(src))
        fail(`_redirects source ${src} has no redirect row in the CSV`);
  }
}

// ----------------------------------------------------------------- live
const live = { redirectOk: 0, goneOk: 0, probes: [] };
async function liveChecks() {
  const get = (path) =>
    fetch(baseUrl + path, {
      redirect: "manual",
      headers: { "User-Agent": "PecoRedesignAudit/1.0 check-redirects" },
    });
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(baseUrl);
  const pause = () => new Promise((r) => setTimeout(r, isLocal ? 0 : 250));
  const targetStatus = new Map();

  for (const r of redirectRows) {
    const where = `${r.url} -> ${r.target}`;
    try {
      const res = await get(
        redirectSource(r.url) +
          (r.url.includes("?") ? "?" + r.url.split("?")[1] : ""),
      );
      await res.body?.cancel();
      const loc = res.headers.get("location");
      const locPath = loc ? new URL(loc, baseUrl + "/").pathname : null;
      if (res.status !== 301)
        fail(`live ${where}: expected 301, got ${res.status}`);
      else if (locPath !== r.target)
        fail(`live ${where}: Location path ${locPath} != ${r.target}`);
      else {
        live.redirectOk++;
        if (!targetStatus.has(r.target)) {
          await pause();
          const t = await get(r.target);
          await t.body?.cancel();
          targetStatus.set(r.target, t.status);
          if (t.status !== 200)
            fail(`live target ${r.target}: expected 200, got ${t.status}`);
        }
      }
    } catch (e) {
      fail(`live ${where}: ${e.message}`);
    }
    await pause();
  }
  for (const r of goneRows) {
    try {
      const res = await get(redirectSource(r.url));
      await res.body?.cancel();
      if (res.status !== 404)
        fail(`live gone ${r.url}: expected 404, got ${res.status}`);
      else live.goneOk++;
    } catch (e) {
      fail(`live gone ${r.url}: ${e.message}`);
    }
    await pause();
  }

  // Informational probes: query-string behaviour.
  const product = redirectRows.find(
    (r) =>
      /^\/index\.php\/exhaust-gas-silencers\/[^/]+\/[^/]+$/.test(r.url) &&
      r.target.startsWith("/products/"),
  );
  const probes = [];
  if (product) probes.push(product.url + "?rCH=2");
  probes.push("/index.php?option=com_content");
  for (const p of probes) {
    try {
      const res = await get(p);
      await res.body?.cancel();
      live.probes.push(
        `${p} -> ${res.status} Location: ${res.headers.get("location") ?? "(none)"}`,
      );
    } catch (e) {
      live.probes.push(`${p} -> error ${e.message}`);
    }
    await pause();
  }
}

if (baseUrl && failures.length === 0) await liveChecks();
else if (baseUrl)
  console.error("Skipping live checks: CSV/static checks failed first.");

// --------------------------------------------------------------- report
console.log(
  `Rows: ${rows.length} (redirect ${redirectRows.length}, gone ${goneRows.length})`,
);
if (staticMode) console.log(`_redirects rules: ${ruleCount}`);
if (baseUrl) {
  console.log(
    `Live ${baseUrl}: ${live.redirectOk}/${redirectRows.length} redirects OK, ${live.goneOk}/${goneRows.length} gone OK`,
  );
  for (const p of live.probes) console.log(`  probe: ${p}`);
}
if (failures.length) {
  console.error(`\nFAIL: ${failures.length} problem(s)`);
  for (const f of failures.slice(0, 100)) console.error(`  - ${f}`);
  if (failures.length > 100)
    console.error(`  ... and ${failures.length - 100} more`);
  process.exit(1);
}
console.log("PASS");
