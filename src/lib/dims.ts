// Dimension helpers shared by the CSV loader, SpecTable and check-products.mjs.
// Plain TypeScript with erasable syntax only, so Node can run it via type stripping.
import type { SizeRow } from "./csv.ts";

const MIXED = /^(\d+)\s(\d+)\/(\d+)$/;
const FRACTION = /^(\d+)\/(\d+)$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/** Parse an inch string as printed ('1 1/2', '3/4', '1.25', '10') to a number. Returns null if unparseable. */
export function parseInches(value: string): number | null {
  const v = value.trim();
  let m = MIXED.exec(v);
  if (m) {
    const den = Number(m[3]);
    return den === 0 ? null : Number(m[1]) + Number(m[2]) / den;
  }
  m = FRACTION.exec(v);
  if (m) {
    const den = Number(m[2]);
    return den === 0 ? null : Number(m[1]) / den;
  }
  return DECIMAL.test(v) ? Number(v) : null;
}

/** Format an inch string for display: '1 1/2' -> '1 1/2"'. Values are kept exactly as printed. */
export function formatInches(value: string): string {
  return `${value.trim()}"`;
}

/** Format millimetres for display: 381 -> '381 mm'. */
export function formatMm(value: number): string {
  return `${value} mm`;
}

/** mm ≈ in × 25.4 within ±1.5 mm or 2% (whichever is larger). */
export function mmMatchesInches(inches: number, mm: number): boolean {
  const expected = inches * 25.4;
  const diff = Math.abs(mm - expected);
  return diff <= 1.5 || diff <= expected * 0.02;
}

/** lbs ≈ kg × 2.2046 within ±3%. */
export function lbsMatchesKg(lbs: number, kg: number): boolean {
  const expected = kg * 2.2046;
  return Math.abs(lbs - expected) <= expected * 0.03;
}

export interface BoreRange {
  minIn: string;
  maxIn: string;
  minMm: number | null;
  maxMm: number | null;
}

/** Smallest and largest bore of a size table, by parsed inch value. Null when no row has a numeric bore. */
export function boreRange(
  rows: ReadonlyArray<Pick<SizeRow, "bore">>,
): BoreRange | null {
  type Entry = { n: number; in: string; mm: number | null };
  let min: Entry | null = null;
  let max: Entry | null = null;
  for (const { bore } of rows) {
    if (bore.kind !== "pair") continue;
    const n = parseInches(bore.in);
    if (n === null) continue;
    const entry = { n, in: bore.in, mm: bore.mm };
    if (!min || n < min.n) min = entry;
    if (!max || n > max.n) max = entry;
  }
  if (!min || !max) return null;
  return { minIn: min.in, maxIn: max.in, minMm: min.mm, maxMm: max.mm };
}
