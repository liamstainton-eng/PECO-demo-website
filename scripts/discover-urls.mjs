// T5d: discover old (Joomla) URLs on pecoindustrial.co.uk and build the 301 map.
//
// Phases (default = all three, in order):
//   --fetch      polite crawl + Wayback CDX  -> docs/old-urls-raw/crawl.json, wayback.json
//                (--crawl / --wayback run just one half)
//   --classify   raw lists -> docs/old-urls.csv (url,action,target,source,note)
//   --redirects  docs/old-urls.csv -> public/_redirects (static rules only)
//
// `--classify` overwrites docs/old-urls.csv. Re-run it only if you have not
// hand-edited the CSV; `--redirects` alone is always safe.
//
// Politeness (the live site belongs to the client): robots.txt respected,
// one request per second, strictly sequential, identifying User-Agent, same
// host only, crawl capped at 300 HTML pages, images/PDFs recorded not fetched.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORY_SLUGS, PRODUCT_SLUGS } from "../src/content/slugs.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "docs", "old-urls-raw");
const CSV_PATH = join(ROOT, "docs", "old-urls.csv");
const REDIRECTS_PATH = join(ROOT, "public", "_redirects");

const SITE = "pecoindustrial.co.uk";
const UA =
  "PecoRedesignAudit/1.0 (contact: sales@pecoindustrial.co.uk site owner project)";
const MAX_PAGES = 300;
const MAX_REDIRECT_HOPS = 5;
const MIN_INTERVAL_MS = 1100; // a little over 1 req/s

// New-site routes that redirects may target, derived from the frozen slug list
// in src/content/slugs.ts (Node type stripping) so a slug change cannot drift.
export const FROZEN_ROUTES = [
  "/",
  "/products",
  ...CATEGORY_SLUGS.map((s) => `/products/${s}`),
  ...PRODUCT_SLUGS.map((s) => `/products/${s}`),
  "/projects",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/cookies",
];

// Files the new site serves itself (robots.txt etc.), so they are not "gone".
const NEW_SITE_FILES = new Set([
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
  "/favicon.svg",
]);

const TRACKING_PARAM =
  /^(utm_.*|fbclid|gclid|msclkid|yclid|dclid|igshid|_ga|_gl|mc_cid|mc_eid|rch|phpsessid)$/i;
const ASSET_EXT =
  /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|pdf|docx?|xlsx?|zip|css|js|map|woff2?|ttf|eot|otf|mp4|mp3|webm|swf)$/i;

// ---------------------------------------------------------------- helpers

/** Normalise to { path, query } on the site's host (apex or www), else null. */
export function normalise(raw, base = `https://${SITE}/`) {
  let u;
  try {
    u = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== SITE) return null;
  const isStatic = ASSET_EXT.test(u.pathname); // cache-busting queries on static files are noise
  const kept = isStatic
    ? []
    : u.search
        .replace(/^\?/, "")
        .split("&")
        .filter(Boolean)
        .filter(
          (p) => !TRACKING_PARAM.test(decodeURIComponent(p.split("=")[0])),
        )
        .sort();
  const query = kept.length ? `?${kept.join("&")}` : "";
  return {
    path: u.pathname || "/",
    query,
    key: `${u.pathname || "/"}${query}`,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
let requestCount = 0;

/** Throttled, sequential fetch. */
async function polite(url, init = {}) {
  const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  requestCount++;
  return fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "text/html,*/*;q=0.8",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
}

function parseRobots(text) {
  // Collect Disallow/Allow rules from groups matching '*' or our UA token.
  const rules = [];
  let applies = false;
  let inAgents = false;
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!inAgents) applies = false;
      inAgents = true;
      if (value === "*" || UA.toLowerCase().startsWith(value.toLowerCase()))
        applies = true;
    } else {
      inAgents = false;
      if (applies && (field === "disallow" || field === "allow") && value) {
        rules.push({ allow: field === "allow", pattern: value });
      }
    }
  }
  return rules;
}

function robotsAllows(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    const re = new RegExp(
      "^" +
        r.pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\\\$$/, "$"),
    );
    if (re.test(pathAndQuery)) {
      if (!best || r.pattern.length > best.pattern.length) best = r;
    }
  }
  return !best || best.allow;
}

function extractRefs(html, pageUrl) {
  // Honour <base href> like a browser would (this is what produces Joomla's
  // relative-link duplicates).
  const baseMatch = html.match(/<base\s[^>]*href\s*=\s*["']([^"']+)["']/i);
  let base = pageUrl;
  if (baseMatch) {
    try {
      base = new URL(baseMatch[1], pageUrl).href;
    } catch {
      /* ignore */
    }
  }
  const links = new Set();
  const resources = new Set();
  const attr =
    /\b(href|src|data-src|data-lazyload|data-thumb|data-image|poster|content)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  for (const tagMatch of html.matchAll(tagRe)) {
    const tag = tagMatch[1].toLowerCase();
    const body = tagMatch[0];
    for (const a of body.matchAll(attr)) {
      const name = a[1].toLowerCase();
      const val = (a[3] ?? a[4] ?? "").trim().replace(/&amp;/g, "&");
      if (
        !val ||
        val.startsWith("#") ||
        /^(mailto|tel|javascript|data):/i.test(val)
      )
        continue;
      if (
        name === "content" &&
        !/^(https?:)?\/\//i.test(val) &&
        !val.startsWith("/")
      )
        continue;
      if (name === "href" && tag === "a") links.add(val);
      else resources.add(val);
    }
    const srcset = body.match(/\bsrcset\s*=\s*"([^"]*)"/i);
    if (srcset)
      for (const part of srcset[1].split(","))
        resources.add(part.trim().split(/\s+/)[0]);
  }
  // url(...) in inline styles / style blocks
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi))
    resources.add(m[1].trim());
  return { base, links: [...links], resources: [...resources] };
}

// ------------------------------------------------------------------ fetch

async function crawl() {
  const seen = new Map(); // key -> page record
  const queue = [];
  const assets = new Map(); // key -> { url, foundOn:Set }
  const otherRefs = new Map(); // non-asset <link>/<meta> URLs (feeds, opensearch, canonical...)
  const skipped = [];
  const external = new Set();

  // robots.txt
  let robotsText = "";
  const rr = await polite(`https://${SITE}/robots.txt`);
  if (rr.ok) robotsText = await rr.text();
  const robots = parseRobots(robotsText);

  const addAsset = (n, from) => {
    const rec = assets.get(n.key) ?? { url: n.key, foundOn: new Set() };
    rec.foundOn.add(from);
    assets.set(n.key, rec);
  };
  const enqueue = (n, from) => {
    if (seen.has(n.key)) {
      seen.get(n.key).linkedFrom.add(from);
      return;
    }
    const rec = { url: n.key, status: null, linkedFrom: new Set([from]) };
    seen.set(n.key, rec);
    if (!robotsAllows(robots, n.key)) {
      rec.status = "robots-blocked";
      return;
    }
    queue.push(n);
  };

  const seed = normalise(`https://${SITE}/`);
  enqueue(seed, "(seed)");

  let fetched = 0;
  while (queue.length && fetched < MAX_PAGES) {
    const n = queue.shift();
    const rec = seen.get(n.key);
    let url = `https://${SITE}${n.key}`;
    try {
      let res;
      const chain = [];
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        res = await polite(url, { redirect: "manual" });
        if (
          res.status >= 300 &&
          res.status < 400 &&
          res.headers.get("location")
        ) {
          const loc = new URL(res.headers.get("location"), url);
          chain.push({ status: res.status, location: loc.href });
          const nl = normalise(loc.href);
          if (!nl) break; // leaves the site: record, don't follow
          url = `https://${SITE}${nl.key}`;
          continue;
        }
        break;
      }
      fetched++;
      rec.status = chain.length ? chain[0].status : res.status;
      if (chain.length) rec.redirects = chain;
      const finalStatus = res.status;
      rec.finalStatus = finalStatus;
      const ct = res.headers.get("content-type") || "";
      rec.contentType = ct;
      if (finalStatus === 200 && /html/i.test(ct)) {
        const html = await res.text();
        const { base, links, resources } = extractRefs(html, url);
        const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (title) rec.title = title[1].replace(/\s+/g, " ").trim();
        for (const r of resources) {
          const nr = normalise(r, base);
          if (nr && ASSET_EXT.test(nr.path)) addAsset(nr, n.key);
          else if (nr) {
            const o = otherRefs.get(nr.key) ?? {
              url: nr.key,
              foundOn: new Set(),
            };
            o.foundOn.add(n.key);
            otherRefs.set(nr.key, o);
          } else if (/^https?:\/\//i.test(r) || r.startsWith("//"))
            external.add(r);
        }
        for (const l of links) {
          const nl = normalise(l, base);
          if (!nl) {
            if (/^https?:\/\//i.test(l)) external.add(l);
            continue;
          }
          if (ASSET_EXT.test(nl.path)) {
            addAsset(nl, n.key);
            continue;
          }
          // crawl-trap guard: skip paths where one segment repeats 3+ times
          const segs = nl.path.split("/").filter(Boolean);
          const counts = {};
          for (const s of segs) counts[s] = (counts[s] || 0) + 1;
          if (Object.values(counts).some((c) => c >= 3) || segs.length > 12) {
            skipped.push({
              url: nl.key,
              reason: "crawl-trap guard",
              from: n.key,
            });
            continue;
          }
          enqueue(nl, n.key);
        }
      } else {
        await res.body?.cancel();
      }
    } catch (err) {
      rec.status = "error";
      rec.error = String(err.message ?? err);
    }
    if (fetched % 10 === 0)
      console.error(`  crawled ${fetched} pages, queue ${queue.length}`);
  }

  const capped = queue.length > 0;
  for (const n of queue)
    skipped.push({ url: n.key, reason: "page cap reached (not fetched)" });

  const pages = [...seen.values()]
    .map((p) => ({ ...p, linkedFrom: [...p.linkedFrom].sort() }))
    .sort((a, b) => a.url.localeCompare(b.url));
  const assetList = [...assets.values()]
    .map((a) => ({ url: a.url, foundOn: [...a.foundOn].sort() }))
    .sort((a, b) => a.url.localeCompare(b.url));

  return {
    generated: new Date().toISOString(),
    userAgent: UA,
    pageCap: MAX_PAGES,
    capReached: capped,
    robotsRules: robots,
    pagesFetched: fetched,
    pages,
    assets: assetList,
    otherReferencedUrls: [...otherRefs.values()]
      .map((a) => ({ url: a.url, foundOn: [...a.foundOn].sort() }))
      .sort((a, b) => a.url.localeCompare(b.url)),
    skipped,
    externalLinks: [...external].sort(),
  };
}

async function wayback() {
  const out = { generated: new Date().toISOString(), queries: [], entries: [] };
  const map = new Map();
  for (const host of [SITE, `www.${SITE}`]) {
    const q = `https://web.archive.org/cdx/search/cdx?url=${host}*&output=json&collapse=urlkey&fl=original,statuscode,mimetype`;
    let rows = [];
    let status = null;
    let error = null;
    for (let attempt = 1; attempt <= 4 && !rows.length; attempt++) {
      try {
        const res = await polite(q);
        status = res.status;
        if (res.ok) rows = JSON.parse((await res.text()) || "[]");
        else {
          await res.body?.cancel();
          if (res.status !== 503 && res.status !== 429) break;
        }
      } catch (err) {
        error = String(err.message ?? err);
      }
      if (!rows.length) await sleep(attempt * 20000); // CDX is flaky: back off politely
    }
    out.queries.push({
      query: q,
      httpStatus: status,
      ...(error ? { error } : {}),
      rows: Math.max(0, rows.length - 1),
    });
    for (const [original, statuscode, mimetype] of rows.slice(1)) {
      const n = normalise(original);
      if (!n) continue;
      const e = map.get(n.key) ?? {
        url: n.key,
        statuses: new Set(),
        mimetypes: new Set(),
        originals: new Set(),
      };
      e.statuses.add(statuscode);
      e.mimetypes.add(mimetype);
      e.originals.add(original);
      map.set(n.key, e);
    }
  }
  out.entries = [...map.values()]
    .map((e) => ({
      url: e.url,
      statuses: [...e.statuses].sort(),
      mimetypes: [...e.mimetypes].sort(),
      originals: [...e.originals].sort(),
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
  return out;
}

// --------------------------------------------------------------- classify

const PRODUCTS = {
  "sea-semi-residential-silencer": "sea",
  "se30-semi-residential-silencer": "se30",
  "se40-residential-silencer": "se40",
  "se30-abs-residential-silencer": "se30-abs",
  "se50-critical-silencer": "se50",
  "sa1-spark-arrestor-silencer": "sa1",
  "sls-industrial-silencer": "sls",
  "se20-industrial-silencer": "se20",
};
const CATEGORY_LABELS = {
  "residential-silencers": "/products/residential",
  "critical-silencers": "/products/critical",
  "industrial-silencers": "/products/industrial",
  "spark-arrestors": "/products/spark-arrestors",
  "spark-arrestor": "/products/spark-arrestors",
};
const LEGAL = {
  "87-gdpr-privacy-policy-notice": "/privacy",
  "88-terms-and-conditions": "/terms",
  "89-cookie-policy": "/cookies",
};

// Datasheet images: [regex on decoded path, target, note]
const IMAGE_RULES = [
  [
    /^\/images\/PECO[ _-]?SEA[ _-]?.*\.png$/i,
    "/products/sea",
    "SEA datasheet image",
  ],
  [
    /^\/images\/PECO[ _-]?SE30[ _-]?ABS.*\.png$/i,
    "/products/se30-abs",
    "SE30 ABS datasheet image",
  ],
  [
    /^\/images\/PECO[ _-]?SE30[ _-]?.*\.png$/i,
    "/products/se30",
    "SE30 datasheet image",
  ],
  [
    /^\/images\/PECO[ _-]?SE40[ _-]?.*\.png$/i,
    "/products/se40",
    "SE40 datasheet image",
  ],
  [
    /^\/images\/PECO[ _-]?SE50[ _-]?.*\.png$/i,
    "/products/se50",
    "SE50 datasheet image",
  ],
  [
    /^\/images\/PECO[ _-]?SE20[ _-]?.*\.png$/i,
    "/products/se20",
    "SE20 datasheet image",
  ],
  [
    /^\/images\/PECO[ _-]?SLS[ _-]?.*\.png$/i,
    "/products/sls",
    "SLS datasheet image",
  ],
  [
    /^\/images\/Peco_SA1_SPARK_ARRESOR\.png$/i,
    "/products/sa1",
    "SA1 datasheet image (original filename misspelt)",
  ],
  [
    /^\/images\/PECO[ _-]?SA1[ _-]?.*\.png$/i,
    "/products/sa1",
    "SA1 datasheet image",
  ],
];

function classify(key, sources, statusInfo) {
  const qi = key.indexOf("?");
  const path = qi === -1 ? key : key.slice(0, qi);
  const query = qi === -1 ? "" : key.slice(qi);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* keep */
  }
  const r = (target, note = "") => ({ action: "redirect", target, note });
  const g = (note = "") => ({ action: "gone", target: "", note });

  // Normalise away index.php and trailing slash for matching.
  const stripped = decoded
    .replace(/^\/index\.php(?=\/|$)/, "")
    .replace(/\/+$/, "");
  const segs = stripped.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  const hasIndex = /^\/index\.php(\/|$)/.test(decoded);

  // Query URLs: _redirects matches paths only, so the query row must agree with
  // its path rule (/index.php?option=... collapses to the /index.php rule).
  if (query) {
    const base = classify(path, sources, statusInfo);
    return {
      ...base,
      note: [
        `query ${query} ignored by _redirects; follows the path rule`,
        base.note,
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  // Legal pages, including the relative-link duplicates
  for (const [slug, target] of Object.entries(LEGAL)) {
    if (last === slug) {
      const dup =
        segs.length > 2 ||
        segs.some((s) => s === "92-information") ||
        /exhaust-gas-silencers/.test(stripped);
      return r(
        target,
        dup
          ? "Joomla relative-link duplicate of legal page (handover 4.3)"
          : "",
      );
    }
  }

  // Admin / system / media
  if (
    /^\/(administrator|cache|components|modules|plugins|templates|media|libraries|includes|language|layouts|bin|cli|tmp|logs|installation)(\/|$)/i.test(
      decoded,
    )
  ) {
    return g("Joomla system/template/media/admin path");
  }

  // Datasheet images
  if (/^\/images\//i.test(decoded)) {
    for (const [re, target, note] of IMAGE_RULES)
      if (re.test(decoded)) return r(target, note);
    return g("Other image/media; not carried over");
  }
  if (ASSET_EXT.test(decoded)) return g("Static file not carried over");

  // Home
  if (stripped === "" || /^\/(index\.html?|home)$/i.test(decoded)) {
    if (decoded === "/") return g("Home itself; new route / needs no redirect");
    return r("/", hasIndex ? "index.php homepage alias" : "homepage alias");
  }
  if (stripped === "/home") return r("/", "homepage alias");

  // Joomla component / search
  if (segs[0] === "component") return g("Joomla component/search URL");
  if (segs[0] === "search" || segs[0] === "component")
    return g("Joomla search URL");

  // About / contact / blog
  if (segs.length === 1 && segs[0] === "about") return r("/about");
  if (segs.length === 1 && segs[0] === "contact") return r("/contact");
  if (segs[0] === "blog")
    return r("/projects", "Blog was empty; projects is the closest new page");

  // Products
  if (segs[0] === "exhaust-gas-silencers") {
    const prod = segs.find((s) => PRODUCTS[s]);
    if (prod) {
      const note =
        segs.length > 2
          ? `category-path variant (${segs.slice(1, -1).join("/")})`
          : "";
      return r(`/products/${PRODUCTS[prod]}`, note);
    }
    if (segs.length === 1)
      return r("/products", "Menu label only on old site (no page)");
    const cat = segs.slice(1).find((s) => CATEGORY_LABELS[s]);
    if (cat) return r(CATEGORY_LABELS[cat], "Old category label");
    return r(
      "/products",
      "Unknown exhaust-gas-silencers sub-path; nearest is the products index",
    );
  }
  for (const s of segs) {
    if (CATEGORY_LABELS[s]) return r(CATEGORY_LABELS[s], "Old category label");
  }
  if (
    segs.length === 1 &&
    ["products", "exhaust-gas-silencers"].includes(segs[0])
  )
    return r("/products");

  return g(`Unrecognised old URL (${statusInfo || "no status"}); not mapped`);
}

/**
 * Variants that real visitors/crawlers may hold but that the crawl did not
 * observe (Joomla SEF with and without index.php, category label pages, trailing
 * slashes). Source = "synth".
 */
function addSynthesised(rows, frozen) {
  const have = new Set(rows.map((r) => r.url));
  const out = [];
  const push = (url, action, target, note) => {
    if (have.has(url) || frozen.has(url) || NEW_SITE_FILES.has(url)) return;
    have.add(url);
    out.push({ url, action, target, source: "synth", note });
  };
  for (const r of [...rows]) {
    if (r.action !== "redirect" || r.url.includes("?")) continue;
    // (a) without index.php
    if (r.url.startsWith("/index.php/")) {
      push(
        r.url.slice("/index.php".length),
        "redirect",
        r.target,
        `synthesised: ${r.url} without index.php (live site serves these with 200)`,
      );
    }
    // (d) trailing-slash twins of the main pages and product pages
    if (
      /^\/index\.php(\/about|\/contact|\/blog|\/exhaust-gas-silencers\/[^/]+\/[^/]+)?$/.test(
        r.url,
      )
    ) {
      push(
        r.url + "/",
        "redirect",
        r.target,
        `synthesised: trailing-slash twin of ${r.url}`,
      );
    }
  }
  // (c) category label pages (menu labels only on the old site, no real page)
  const base = "exhaust-gas-silencers";
  for (const prefix of ["/index.php", ""]) {
    push(
      `${prefix}/${base}`,
      "redirect",
      "/products",
      "synthesised: menu label only on old site (no page)",
    );
    for (const [label, target] of Object.entries(CATEGORY_LABELS)) {
      if (label === "spark-arrestor") continue; // singular alias is only used for matching
      push(
        `${prefix}/${base}/${label}`,
        "redirect",
        target,
        "synthesised: category label (menu label only on old site, no page)",
      );
    }
  }
  rows.push(...out);
  rows.sort((a, b) => a.url.localeCompare(b.url));
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function loadRaw() {
  const crawl = JSON.parse(readFileSync(join(RAW_DIR, "crawl.json"), "utf8"));
  const wb = JSON.parse(readFileSync(join(RAW_DIR, "wayback.json"), "utf8"));
  return { crawl, wb };
}

function runClassify() {
  const { crawl, wb } = loadRaw();
  const all = new Map(); // key -> { sources:Set, status }
  const add = (key, src, status) => {
    const e = all.get(key) ?? { sources: new Set(), status: new Set() };
    e.sources.add(src);
    if (status) e.status.add(String(status));
    all.set(key, e);
  };
  for (const p of crawl.pages) add(p.url, "crawl", p.status);
  for (const a of crawl.assets) add(a.url, "crawl-asset");
  for (const a of crawl.otherReferencedUrls ?? []) add(a.url, "crawl-ref");
  for (const e of wb.entries) add(e.url, "wayback", e.statuses.join("/"));

  const rows = [];
  const frozen = new Set(FROZEN_ROUTES);
  const skippedNewRoutes = [];
  for (const [key, e] of [...all.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (frozen.has(key.split("?")[0]) || NEW_SITE_FILES.has(key)) {
      skippedNewRoutes.push(key); // path the new site serves itself: no old URL to redirect
      continue;
    }
    const c = classify(key, e.sources, [...e.status].join("/"));
    rows.push({ url: key, ...c, source: [...e.sources].sort().join("+") });
  }
  addSynthesised(rows, frozen);

  const header = "url,action,target,source,note";
  const lines = rows.map((r) =>
    [r.url, r.action, r.target, r.source, r.note].map(csvCell).join(","),
  );
  writeFileSync(CSV_PATH, [header, ...lines].join("\n") + "\n");
  const counts = rows.reduce(
    (m, r) => ((m[r.action] = (m[r.action] || 0) + 1), m),
    {},
  );
  console.log(`Wrote ${CSV_PATH}: ${rows.length} rows`, counts);
  if (skippedNewRoutes.length)
    console.log(
      `Skipped (path equals a new route): ${skippedNewRoutes.join(", ")}`,
    );
}

// -------------------------------------------------------------- redirects

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Path part of a CSV url (query dropped: _redirects cannot match queries). */
export function redirectSource(url) {
  const p = url.split("?")[0];
  return p.replace(/ /g, "%20");
}

function runRedirects() {
  const [head, ...rows] = parseCsv(readFileSync(CSV_PATH, "utf8"));
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const rules = new Map(); // source -> target
  const frozen = new Set(FROZEN_ROUTES);
  for (const r of rows) {
    if (r[idx.action] !== "redirect") continue;
    const src = redirectSource(r[idx.url]);
    const target = r[idx.target];
    if (frozen.has(src)) continue; // would loop
    const prev = rules.get(src);
    if (prev && prev !== target)
      throw new Error(`Conflicting targets for ${src}: ${prev} vs ${target}`);
    rules.set(src, target);
  }
  if (rules.size >= 2000)
    throw new Error(`${rules.size} rules exceeds the 2,000 static rule limit`);
  const out = [
    "# Generated by scripts/discover-urls.mjs from docs/old-urls.csv. Do not edit by hand.",
    "# Static, exact-path 301 rules only (no splats). Cloudflare Pages matches paths, not query strings.",
    "",
    ...[...rules.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([s, t]) => `${s} ${t} 301`),
  ];
  mkdirSync(dirname(REDIRECTS_PATH), { recursive: true });
  writeFileSync(REDIRECTS_PATH, out.join("\n") + "\n");
  console.log(`Wrote ${REDIRECTS_PATH}: ${rules.size} rules`);
}

// ------------------------------------------------------------------- main

async function main() {
  const args = new Set(process.argv.slice(2));
  const any = [
    "--fetch",
    "--crawl",
    "--wayback",
    "--classify",
    "--redirects",
  ].some((f) => args.has(f));
  const doCrawl = !any || args.has("--fetch") || args.has("--crawl");
  const doWayback = !any || args.has("--fetch") || args.has("--wayback");
  const doClassify = !any || args.has("--classify");
  const doRedirects = !any || args.has("--redirects");

  mkdirSync(RAW_DIR, { recursive: true });
  if (doCrawl) {
    console.error("Crawling live site (1 req/s, sequential)...");
    const c = await crawl();
    writeFileSync(
      join(RAW_DIR, "crawl.json"),
      JSON.stringify(c, null, 2) + "\n",
    );
    console.error(
      `Crawl done: ${c.pagesFetched} pages fetched, ${c.pages.length} page URLs, ${c.assets.length} asset URLs.`,
    );
  }
  if (doWayback) {
    console.error("Querying Wayback CDX...");
    const w = await wayback();
    if (w.entries.length || !existsSync(join(RAW_DIR, "wayback.json"))) {
      writeFileSync(
        join(RAW_DIR, "wayback.json"),
        JSON.stringify(w, null, 2) + "\n",
      );
    } else
      console.error("Wayback returned nothing; keeping existing wayback.json");
    console.error(
      `Wayback done: ${w.entries.length} unique URLs. HTTP requests this run: ${requestCount}.`,
    );
  }
  if (doClassify) runClassify();
  if (doRedirects) runRedirects();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
