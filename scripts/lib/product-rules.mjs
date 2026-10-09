// Pure size-table sanity rules for check-products.mjs (unit-tested in
// tests/unit/product-rules.test.mjs). No file I/O.
//
// Anomaly tokens: a row's `note` may carry space-separated tokens that excuse
// exactly one rule (and, where the rule is per column, one column):
//   anomaly:mm-mismatch:<col>   mm vs inches outside tolerance in <col> ("bore" or a column key)
//   anomaly:wt-mismatch         lbs vs kg outside tolerance
//   anomaly:bore-order          bore not after the previous row's bore
//   anomaly:part-sequence       part number not after the previous one of the same series
//   anomaly:fixture             marks a fixture row; required on every row of a
//                               sizesStatus "fixture" table and forbidden elsewhere.
//                               It excuses nothing.
// Unknown tokens, a missing or unknown column, and tokens that excuse nothing are errors.
import {
  lbsMatchesKg,
  mmMatchesInches,
  parseInches,
} from "../../src/lib/dims.ts";

export const ANOMALY_RULES = {
  "mm-mismatch": { column: true },
  "wt-mismatch": { column: false },
  "bore-order": { column: false },
  "part-sequence": { column: false },
  fixture: { column: false },
};

const TOKEN_RE = /(?:^|\s)anomaly:(\S*)/g;

/**
 * Parse anomaly tokens from a row note.
 * @param {string} note
 * @param {string[]} columnKeys keys a per-column token may name ("bore" is always allowed)
 * @returns {{ tokens: { rule: string, column: string | null, raw: string }[], errors: string[] }}
 */
export function parseAnomalies(note, columnKeys) {
  const tokens = [];
  const errors = [];
  const keys = new Set(["bore", ...columnKeys]);
  for (const m of note.matchAll(TOKEN_RE)) {
    const raw = `anomaly:${m[1]}`;
    const [rule, column, ...rest] = m[1].split(":");
    const def = Object.hasOwn(ANOMALY_RULES, rule) ? ANOMALY_RULES[rule] : null;
    if (!def) {
      errors.push(`unknown anomaly rule in "${raw}"`);
      continue;
    }
    if (rest.length > 0) {
      errors.push(`malformed anomaly token "${raw}"`);
      continue;
    }
    if (def.column) {
      if (!column) {
        errors.push(`"${raw}" must name a column, e.g. anomaly:${rule}:A`);
        continue;
      }
      if (!keys.has(column)) {
        errors.push(`"${raw}" names unknown column "${column}"`);
        continue;
      }
    } else if (column !== undefined) {
      errors.push(`"${raw}" takes no column`);
      continue;
    }
    tokens.push({ rule, column: def.column ? column : null, raw });
  }
  return { tokens, errors };
}

const PART_RE = /^([A-Z][A-Z0-9]*?)\s?(\d+)(?:\s?([A-Z]))?$/;

/**
 * Split a part number as printed into series prefix, number and optional
 * variant suffix: "SEA 101", "SE 206", "SE206", "SA 102 A", "SE 104S".
 * @returns {{ prefix: string, number: number, suffix: string } | null}
 */
export function parsePartNo(partNo) {
  const m = PART_RE.exec(partNo.trim());
  if (!m) return null;
  return { prefix: m[1], number: Number(m[2]), suffix: m[3] ?? "" };
}

/** Negative, zero or positive as part a sorts before, with or after b (same series). */
export function comparePartNos(a, b) {
  if (a.number !== b.number) return a.number - b.number;
  if (a.suffix === b.suffix) return 0;
  return a.suffix < b.suffix ? -1 : 1; // no suffix sorts first
}

/**
 * Hard (unexcusable) problems: unparseable part numbers, missing columns and
 * non-positive values. The CSV loader already rejects most of these; this is a
 * second line of defence that does not depend on the loader.
 * @returns {string[]}
 */
export function hardProblems(row, columns) {
  const out = [];
  if (!parsePartNo(row.partNo))
    out.push(
      `part number "${row.partNo}" is not "<series> <number>[ <suffix letter>]"`,
    );
  const positive = (label, v) => {
    if (!(typeof v === "number" && Number.isFinite(v) && v > 0))
      out.push(`${label} must be a positive number, got ${v}`);
  };
  const inches = (label, v) => {
    const n = parseInches(v);
    if (n === null || !(n > 0))
      out.push(`${label} "${v}" is not a positive inch value`);
  };
  const cells = [
    ["bore", row.bore],
    ...columns.map((c) => [c.key, row.dims[c.key]]),
  ];
  for (const [key, cell] of cells) {
    if (!cell) {
      out.push(`column ${key} missing`);
      continue;
    }
    if (cell.kind === "pair") {
      inches(`${key} in`, cell.in);
      if (cell.mm !== null) positive(`${key} mm`, cell.mm);
      if (cell.raw2 !== undefined) inches(`${key} raw2`, cell.raw2);
    } else if (cell.kind === "holes") {
      if (!Number.isInteger(cell.count) || cell.count <= 0)
        out.push(
          `${key} hole count must be a positive whole number, got ${cell.count}`,
        );
      inches(`${key} dia`, cell.dia);
      if (cell.mm !== null) positive(`${key} mm`, cell.mm);
    } else if (cell.kind === "bolt") {
      inches(`${key} size`, cell.size);
      if (cell.mm !== null) positive(`${key} mm`, cell.mm);
    }
  }
  for (const [label, cell] of [
    ["wt lbs", row.wt.lbs],
    ["wt kg", row.wt.kg],
  ])
    if (cell.kind === "num") positive(label, cell.value);
  return out;
}

/** Fresh running state for rowAnomalies (one per size table). */
export const newSequenceState = () => ({ bore: null, parts: new Map() });

/**
 * Excusable sanity anomalies for one row. `state` (from newSequenceState) carries
 * the previous bore and the previous part number per series; it is updated in place.
 * @returns {{ rule: string, column: string | null, message: string }[]}
 */
export function rowAnomalies(row, columns, state) {
  const found = [];
  const pairs = [
    ["bore", row.bore],
    ...columns
      .filter((c) => c.kind === "pair")
      .map((c) => [c.key, row.dims[c.key]]),
  ];
  for (const [key, cell] of pairs) {
    if (!cell || cell.kind !== "pair" || cell.mm === null) continue; // na, todo, raw2
    const inches = parseInches(cell.in);
    if (inches === null) continue; // reported by hardProblems
    if (!mmMatchesInches(inches, cell.mm))
      found.push({
        rule: "mm-mismatch",
        column: key,
        message: `${key}: ${cell.in} in vs ${cell.mm} mm (expected ~${(inches * 25.4).toFixed(1)})`,
      });
  }

  const { lbs, kg } = row.wt;
  if (
    lbs.kind === "num" &&
    kg.kind === "num" &&
    !lbsMatchesKg(lbs.value, kg.value)
  )
    found.push({
      rule: "wt-mismatch",
      column: null,
      message: `weight: ${lbs.value} lbs vs ${kg.value} kg (expected ~${(kg.value * 2.2046).toFixed(1)} lbs)`,
    });

  const bore = row.bore.kind === "pair" ? parseInches(row.bore.in) : null;
  if (bore !== null) {
    const p = state.bore;
    if (
      p &&
      (bore < p.value || (bore === p.value && row.markers === p.markers))
    )
      found.push({
        rule: "bore-order",
        column: null,
        message: `bore ${row.bore.in} not after ${p.partNo} (${p.value}${p.markers ? ` ${p.markers}` : ""})`,
      });
    state.bore = { value: bore, markers: row.markers, partNo: row.partNo };
  }

  const part = parsePartNo(row.partNo);
  if (part) {
    const p = state.parts.get(part.prefix);
    if (p && comparePartNos(part, p.part) <= 0)
      found.push({
        rule: "part-sequence",
        column: null,
        message: `part number ${row.partNo} not after ${p.partNo}`,
      });
    state.parts.set(part.prefix, { part, partNo: row.partNo });
  }
  return found;
}

/**
 * Match anomalies to the row's tokens.
 * @returns {{ unexplained: string[], unused: string[] }} messages of anomalies with no
 *   matching token, and raw tokens that excuse nothing ("fixture" is never unused).
 */
export function explainAnomalies(anomalies, tokens) {
  const used = new Set();
  const unexplained = [];
  for (const a of anomalies) {
    const t = tokens.find((t) => t.rule === a.rule && t.column === a.column);
    if (t) used.add(t.raw);
    else unexplained.push(a.message);
  }
  const unused = tokens
    .filter((t) => t.rule !== "fixture" && !used.has(t.raw))
    .map((t) => t.raw);
  return { unexplained, unused };
}

/** Part numbers that appear more than once (always fatal). */
export function duplicatePartNos(rows) {
  const seen = new Set();
  const dups = [];
  for (const r of rows) {
    if (seen.has(r.partNo)) dups.push(r.partNo);
    seen.add(r.partNo);
  }
  return dups;
}
