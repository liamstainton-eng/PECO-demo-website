import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comparePartNos,
  duplicatePartNos,
  explainAnomalies,
  hardProblems,
  newSequenceState,
  parseAnomalies,
  parsePartNo,
  rowAnomalies,
} from "../../scripts/lib/product-rules.mjs";

const COLUMNS = [
  { key: "A", label: "A", kind: "pair" },
  { key: "Hmax", label: "H Max", kind: "pair" },
  { key: "N", label: "N", kind: "holes" },
];
const KEYS = COLUMNS.map((c) => c.key);

const row = (partNo, boreIn, boreMm, extra = {}) => ({
  partNo,
  fig: null,
  markers: "",
  bore: { kind: "pair", in: boreIn, mm: boreMm },
  dims: {
    A: { kind: "pair", in: "15", mm: 381 },
    Hmax: { kind: "pair", in: "5", mm: 127 },
    N: { kind: "holes", count: 4, dia: "11/16", mm: 17 },
  },
  wt: { lbs: { kind: "num", value: 4 }, kg: { kind: "num", value: 1.8 } },
  note: "",
  ...extra,
});

const run = (rows) => {
  const state = newSequenceState();
  return rows.map((r) => rowAnomalies(r, COLUMNS, state));
};

test("parseAnomalies reads structured tokens", () => {
  const { tokens, errors } = parseAnomalies(
    "datasheet misprint anomaly:mm-mismatch:Hmax anomaly:bore-order",
    KEYS,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(tokens, [
    { rule: "mm-mismatch", column: "Hmax", raw: "anomaly:mm-mismatch:Hmax" },
    { rule: "bore-order", column: null, raw: "anomaly:bore-order" },
  ]);
  assert.deepEqual(parseAnomalies("anomaly:mm-mismatch:bore", KEYS).errors, []);
  assert.deepEqual(parseAnomalies("free text only", KEYS).tokens, []);
});

test("parseAnomalies rejects unknown, malformed and mis-scoped tokens", () => {
  const bad = (note, re) => {
    const { tokens, errors } = parseAnomalies(note, KEYS);
    assert.equal(tokens.length, 0, note);
    assert.equal(errors.length, 1, note);
    assert.match(errors[0], re);
  };
  bad("anomaly:typo", /unknown anomaly rule/);
  bad("anomaly:", /unknown anomaly rule/);
  bad("anomaly:constructor", /unknown anomaly rule/);
  bad("anomaly:mm-mismatch", /must name a column/);
  bad("anomaly:mm-mismatch:Z", /unknown column "Z"/);
  bad("anomaly:bore-order:A", /takes no column/);
  bad("anomaly:mm-mismatch:A:B", /malformed/);
});

test("a note excuses only the listed rule and column", () => {
  // Hmax wrong (5 in != 200 mm) and A wrong (15 in != 100 mm)
  const r = row("SEA 101", "1", 25);
  r.dims.Hmax = { kind: "pair", in: "5", mm: 200 };
  r.dims.A = { kind: "pair", in: "15", mm: 100 };
  const [anomalies] = run([r]);
  assert.deepEqual(
    anomalies.map((a) => [a.rule, a.column]),
    [
      ["mm-mismatch", "A"],
      ["mm-mismatch", "Hmax"],
    ],
  );
  const { tokens } = parseAnomalies("anomaly:mm-mismatch:Hmax", KEYS);
  const { unexplained, unused } = explainAnomalies(anomalies, tokens);
  assert.equal(unexplained.length, 1);
  assert.match(unexplained[0], /^A: 15 in vs 100 mm/);
  assert.deepEqual(unused, []);
});

test("free text, a fixture token or a different rule never excuse an anomaly", () => {
  const r = row("SEA 101", "1", 25, {
    wt: { lbs: { kind: "num", value: 40 }, kg: { kind: "num", value: 1.8 } },
  });
  const [anomalies] = run([r]);
  assert.deepEqual(
    anomalies.map((a) => a.rule),
    ["wt-mismatch"],
  );
  for (const note of [
    "# FIXTURE: sample rows",
    "anomaly:fixture",
    "anomaly:bore-order",
    "anomaly:mm-mismatch:A",
  ]) {
    const { tokens } = parseAnomalies(note, KEYS);
    assert.equal(
      explainAnomalies(anomalies, tokens).unexplained.length,
      1,
      note,
    );
  }
  const { tokens } = parseAnomalies("anomaly:wt-mismatch", KEYS);
  assert.deepEqual(explainAnomalies(anomalies, tokens), {
    unexplained: [],
    unused: [],
  });
});

test("unused tokens are reported, fixture is not", () => {
  const [anomalies] = run([row("SEA 101", "1", 25)]);
  assert.deepEqual(anomalies, []);
  const { tokens } = parseAnomalies(
    "anomaly:fixture anomaly:mm-mismatch:A",
    KEYS,
  );
  assert.deepEqual(explainAnomalies(anomalies, tokens).unused, [
    "anomaly:mm-mismatch:A",
  ]);
});

test("bore order: decreasing or repeated bores are anomalies, markers separate repeats", () => {
  const [, second] = run([
    row("SEA 101", "2", 51),
    row("SEA 102", "1 1/2", 38),
  ]);
  assert.deepEqual(
    second.map((a) => a.rule),
    ["bore-order"],
  );
  const [, same] = run([row("SEA 101", "2", 51), row("SEA 102", "2", 51)]);
  assert.deepEqual(
    same.map((a) => a.rule),
    ["bore-order"],
  );
  const [, marked] = run([
    row("SEA 101", "2", 51),
    row("SEA 102", "2", 51, { markers: "S" }),
  ]);
  assert.deepEqual(marked, []);
});

test("parsePartNo handles the datasheet variants", () => {
  assert.deepEqual(parsePartNo("SEA 101"), {
    prefix: "SEA",
    number: 101,
    suffix: "",
  });
  assert.deepEqual(parsePartNo("SE 206"), {
    prefix: "SE",
    number: 206,
    suffix: "",
  });
  assert.deepEqual(parsePartNo("SE206"), {
    prefix: "SE",
    number: 206,
    suffix: "",
  });
  assert.deepEqual(parsePartNo("SA 102 A"), {
    prefix: "SA",
    number: 102,
    suffix: "A",
  });
  assert.deepEqual(parsePartNo("SE 104S"), {
    prefix: "SE",
    number: 104,
    suffix: "S",
  });
  assert.deepEqual(parsePartNo("SE20 101"), {
    prefix: "SE20",
    number: 101,
    suffix: "",
  });
  assert.equal(parsePartNo("101"), null);
  assert.equal(parsePartNo("SEA-101"), null);
  assert.equal(parsePartNo("SEA 101 AB"), null);
  assert.equal(parsePartNo(""), null);
});

test("part numbers must strictly increase within a series", () => {
  const cmp = (a, b) =>
    Math.sign(comparePartNos(parsePartNo(a), parsePartNo(b)));
  assert.equal(cmp("SA 102", "SA 102 A"), -1);
  assert.equal(cmp("SA 102 A", "SA 103"), -1);
  assert.equal(cmp("SA 102 A", "SA 102 A"), 0);

  const ok = run([
    row("SA 101", "1", 25),
    row("SA 102", "1 1/4", 32),
    row("SA 102 A", "1 1/2", 38),
    row("SA 103", "2", 51),
  ]);
  assert.deepEqual(ok.flat(), []);

  const back = run([row("SEA 102", "1", 25), row("SEA 101", "1 1/4", 32)]);
  assert.deepEqual(
    back[1].map((a) => a.rule),
    ["part-sequence"],
  );
  const repeat = run([row("SEA 102", "1", 25), row("SEA 102", "1 1/4", 32)]);
  assert.deepEqual(
    repeat[1].map((a) => a.rule),
    ["part-sequence"],
  );
  // Series are sequenced independently.
  const series = run([
    row("SE 205", "1", 25),
    row("SEA 101", "1 1/4", 32),
    row("SE 206", "1 1/2", 38),
  ]);
  assert.deepEqual(series.flat(), []);
});

test("hardProblems: non-positive values and unparseable part numbers", () => {
  assert.deepEqual(hardProblems(row("SEA 101", "1", 25), COLUMNS), []);
  const r = row("SEA-101", "0", 0);
  r.dims.N = { kind: "holes", count: 0, dia: "11/16", mm: -1 };
  r.wt = { lbs: { kind: "num", value: 0 }, kg: { kind: "na" } };
  const problems = hardProblems(r, COLUMNS).join("\n");
  assert.match(problems, /part number "SEA-101"/);
  assert.match(problems, /bore in "0" is not a positive inch value/);
  assert.match(problems, /bore mm must be a positive number, got 0/);
  assert.match(problems, /N hole count must be a positive whole number, got 0/);
  assert.match(problems, /N mm must be a positive number, got -1/);
  assert.match(problems, /wt lbs must be a positive number, got 0/);
  const missing = row("SEA 101", "1", 25);
  delete missing.dims.Hmax;
  assert.deepEqual(hardProblems(missing, COLUMNS), ["column Hmax missing"]);
});

test("duplicatePartNos", () => {
  assert.deepEqual(
    duplicatePartNos([{ partNo: "A 1" }, { partNo: "A 2" }, { partNo: "A 1" }]),
    ["A 1"],
  );
});
