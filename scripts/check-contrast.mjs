#!/usr/bin/env node
// Reads the @theme colour tokens from src/styles/global.css and checks declared
// foreground/background pairs against WCAG 2.2 contrast minimums:
// text >= 4.5:1, UI components and focus indicators >= 3:1. No dependencies.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/styles/global.css"), "utf8");
const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
if (!theme) {
  console.error("check-contrast: no @theme block in src/styles/global.css");
  process.exit(1);
}

const tokens = {};
for (const m of theme[1].matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g))
  tokens[m[1]] = m[2].trim();

const TEXT = 4.5;
const UI = 3;

/** [foreground token, background token, minimum, what it is] */
const pairs = [
  ["ink", "paper", TEXT, "body text on paper"],
  ["ink", "paper-2", TEXT, "body text on off-white sections"],
  ["paper", "ink", TEXT, "text on dark sections"],
  ["paper", "accent", TEXT, "primary button label"],
  ["paper", "accent-hover", TEXT, "primary button label (hover)"],
  ["accent", "paper", TEXT, "accent text/links on paper"],
  ["steel-600", "paper", TEXT, "muted text on paper"],
  ["steel-600", "paper-2", TEXT, "muted text on off-white"],
  ["steel-700", "paper", TEXT, "secondary text on paper"],
  ["steel-300", "ink", TEXT, "footer text on footer bg"],
  ["steel-200", "ink", TEXT, "tagline on dark sections"],
  ["accent", "paper", UI, "primary button boundary on paper"],
  ["steel-400", "ink", UI, "footer link underline on footer bg"],
  ["focus", "paper", UI, "focus ring on paper"],
  ["focus", "paper-2", UI, "focus ring on off-white"],
  ["focus-on-dark", "ink", UI, "focus ring on dark sections"],
  ["paper", "accent", UI, "focus ring (white, inset) on mobile quote button"],
  ["paper", "ink", UI, "focus ring (white, inset) on mobile call button"],
];

function parseColor(value) {
  const v = value.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  m = v.match(
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.%]+\s*)?\)$/,
  );
  if (m)
    return oklchToSrgb(
      parseFloat(m[1]) / (m[2] ? 100 : 1),
      parseFloat(m[3]),
      parseFloat(m[4]),
    );
  throw new Error(`unsupported colour "${value}" (use hex or oklch)`);
}

// OKLCH -> gamma-encoded sRGB (clamped), per CSS Color 4.
function oklchToSrgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((c) => {
    const x = Math.min(1, Math.max(0, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  });
}

// WCAG 2.x relative luminance.
function luminance([r, g, b]) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const failures = [];
console.log("check-contrast: tokens from src/styles/global.css @theme\n");
for (const [fgName, bgName, min, label] of pairs) {
  const fg = tokens[fgName];
  const bg = tokens[bgName];
  if (!fg || !bg) {
    failures.push(`${label}: missing token ${!fg ? fgName : bgName}`);
    continue;
  }
  const r = ratio(parseColor(fg), parseColor(bg));
  const ok = r >= min;
  const line = `${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1 (min ${min})  ${fgName} ${fg} on ${bgName} ${bg}  ${label}`;
  console.log(line);
  if (!ok) failures.push(line);
}

if (failures.length) {
  console.error(`\ncheck-contrast: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\ncheck-contrast: all ${pairs.length} pairs pass`);
