// T5d: validate docs/old-urls.csv and the generated public/_redirects.
//
// Usage: node scripts/check-redirects.mjs [baseUrl ...] [--static]
//   (always)  CSV integrity: header, valid action, redirect rows have a target,
//             gone rows have none, every target is a frozen new-site route.
//   --static  every redirect row appears in public/_redirects with the same
//             target and 301; no _redirects source equals a frozen route.
//   baseUrl   live mode, once per base URL (pass both apex and www):
//             redirect rows must answer 301 with Location path == target and the
//             target must be 200; gone rows must be 404. Query-string cases are
//             assertions too: `<product url>?rCH=2` must 301 to that product, and
//             `/index.php?option=com_content` must 301 to the CSV target of
//             `/index.php` (Cloudflare matches paths, not query strings).
//             A leading cross-host 301/308 with the same path (apex -> www) is
//             followed first. Each base writes docs/qa/redirects-<host>.json.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FROZEN_ROUTES, parseCsv, redirectSource } from "./discover-urls.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_PATH = join(ROOT, "docs", "old-urls.csv");
const REDIRECTS_PATH = join(ROOT, "public", "_redirects");
const EXPECTED_HEADER = ["url", "action", "target", "source", "note"];

const argv = process.argv.slice(2);
const staticMode = argv.includes("--static");
const baseUrls = argv
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.replace(/\/+$/, ""));
for (const b of baseUrls) {
  try {
    new URL(b);
  } catch {
    console.error(`Not a URL: ${b}`);
    process.exit(1);
  }
}

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
const UA = { "User-Agent": "PecoRedesignAudit/1.0 check-redirects" };
const HOST_HOPS = 2;

/**
 * Request `path` on `base` without following redirects, except leading
 * cross-host hops that keep the path (apex -> www canonicalisation).
 * Returns { status, location, locationUrl, hops } where hops lists the host hops.
 */
async function request(base, path) {
  let url = new URL(path, base + "/");
  const hops = [];
  for (let i = 0; ; i++) {
    const res = await fetch(url, { redirect: "manual", headers: UA });
    await res.body?.cancel();
    const location = res.headers.get("location");
    const locationUrl = location ? new URL(location, url) : null;
    const hostHop =
      locationUrl &&
      (res.status === 301 || res.status === 308) &&
      locationUrl.origin !== url.origin &&
      locationUrl.pathname === url.pathname &&
      i < HOST_HOPS;
    if (!hostHop) return { status: res.status, location, locationUrl, hops };
    hops.push(`${res.status} ${url.origin} -> ${locationUrl.origin}`);
    url = locationUrl;
  }
}

async function liveChecks(base) {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(base);
  const pause = () => new Promise((r) => setTimeout(r, isLocal ? 0 : 250));
  const report = {
    baseUrl: base,
    checkedAt: new Date().toISOString(),
    gitSha: (() => {
      try {
        return execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: ROOT,
          encoding: "utf8",
        }).trim();
      } catch {
        return null;
      }
    })(),
    counts: { redirectOk: 0, redirect: 0, goneOk: 0, gone: 0, probeOk: 0, probe: 0 },
    failures: [],
    redirects: [],
    gone: [],
    probes: [],
  };
  const lfail = (msg) => {
    report.failures.push(msg);
    fail(`[${base}] ${msg}`);
  };
  const targetStatus = new Map();

  /** Assert `path` 301s to `target` (path compared; query ignored) and the target is 200. */
  async function expectRedirect(path, target, label) {
    const entry = { url: path, expected: `301 -> ${target} -> 200`, ok: false };
    try {
      const r = await request(base, path);
      Object.assign(entry, {
        status: r.status,
        location: r.location,
        hostHops: r.hops,
      });
      const locPath = r.locationUrl?.pathname ?? null;
      if (r.status !== 301)
        lfail(`${label} ${path} -> ${target}: expected 301, got ${r.status}`);
      else if (locPath !== target)
        lfail(`${label} ${path}: Location path ${locPath} != ${target}`);
      else {
        const key = r.locationUrl.origin + target;
        if (!targetStatus.has(key)) {
          await pause();
          const t = await fetch(new URL(target, r.locationUrl), {
            redirect: "manual",
            headers: UA,
          });
          await t.body?.cancel();
          targetStatus.set(key, t.status);
        }
        entry.targetStatus = targetStatus.get(key);
        if (entry.targetStatus !== 200)
          lfail(`${label} target ${key}: expected 200, got ${entry.targetStatus}`);
        else entry.ok = true;
      }
    } catch (e) {
      entry.error = e.message;
      lfail(`${label} ${path}: ${e.message}`);
    }
    await pause();
    return entry;
  }

  for (const r of redirectRows) {
    const path =
      redirectSource(r.url) +
      (r.url.includes("?") ? "?" + r.url.split("?")[1] : "");
    const entry = await expectRedirect(path, r.target, "redirect");
    report.redirects.push(entry);
    report.counts.redirect++;
    if (entry.ok) report.counts.redirectOk++;
  }

  for (const r of goneRows) {
    const path = redirectSource(r.url);
    const entry = { url: path, expected: "404", ok: false };
    try {
      const res = await request(base, path);
      Object.assign(entry, {
        status: res.status,
        location: res.location,
        hostHops: res.hops,
      });
      if (res.status !== 404)
        lfail(`gone ${r.url}: expected 404, got ${res.status}`);
      else entry.ok = true;
    } catch (e) {
      entry.error = e.message;
      lfail(`gone ${r.url}: ${e.message}`);
    }
    report.gone.push(entry);
    report.counts.gone++;
    if (entry.ok) report.counts.goneOk++;
    await pause();
  }

  // Query-string cases (assertions).
  const probes = [];
  const product = redirectRows.find(
    (r) =>
      /^\/index\.php\/exhaust-gas-silencers\/[^/?]+\/[^/?]+$/.test(r.url) &&
      r.target.startsWith("/products/"),
  );
  if (product) probes.push([product.url + "?rCH=2", product.target]);
  else lfail("probe: no old product URL row found for the ?rCH=2 case");
  const indexRow = redirectRows.find((r) => r.url === "/index.php");
  if (indexRow) probes.push(["/index.php?option=com_content", indexRow.target]);
  else lfail("probe: no /index.php redirect row found for the com_content case");
  for (const [path, target] of probes) {
    const entry = await expectRedirect(path, target, "probe");
    report.probes.push(entry);
    report.counts.probe++;
    if (entry.ok) report.counts.probeOk++;
  }
  return report;
}

const reports = [];
if (baseUrls.length && failures.length === 0) {
  const outDir = join(ROOT, "docs", "qa");
  mkdirSync(outDir, { recursive: true });
  for (const base of baseUrls) {
    const report = await liveChecks(base);
    const host = new URL(base).host.replace(/[^A-Za-z0-9.-]/g, "_");
    report.file = `docs/qa/redirects-${host}.json`;
    writeFileSync(
      join(ROOT, report.file),
      JSON.stringify({ ...report, pass: report.failures.length === 0 }, null, 2) +
        "\n",
    );
    reports.push(report);
  }
} else if (baseUrls.length)
  console.error("Skipping live checks: CSV/static checks failed first.");

// --------------------------------------------------------------- report
console.log(
  `Rows: ${rows.length} (redirect ${redirectRows.length}, gone ${goneRows.length})`,
);
if (staticMode) console.log(`_redirects rules: ${ruleCount}`);
for (const r of reports) {
  const c = r.counts;
  console.log(
    `Live ${r.baseUrl}: ${c.redirectOk}/${c.redirect} redirects OK, ${c.goneOk}/${c.gone} gone OK, ${c.probeOk}/${c.probe} query-string probes OK -> ${r.file}`,
  );
  for (const p of r.probes)
    console.log(
      `  probe: ${p.url} -> ${p.status ?? "error"} Location: ${p.location ?? "(none)"}${p.targetStatus ? ` (target ${p.targetStatus})` : ""} ${p.ok ? "OK" : "FAIL"}`,
    );
}
if (failures.length) {
  console.error(`\nFAIL: ${failures.length} problem(s)`);
  for (const f of failures.slice(0, 100)) console.error(`  - ${f}`);
  if (failures.length > 100)
    console.error(`  ... and ${failures.length - 100} more`);
  process.exit(1);
}
console.log("PASS");
