import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedHeader, loadSizesCsv, parseCsv } from "../../src/lib/csv.ts";

const COLUMNS = [
  { key: "A", label: "A", kind: "pair" },
  { key: "G", label: "G", kind: "pair" },
  { key: "N", label: "N", kind: "holes" },
  { key: "R", label: "R", kind: "bolt" },
];
const HEADER =
  "partNo,fig,markers,bore_in,bore_mm,A_in,A_mm,G_in,G_mm,N_count,N_dia,N_mm,R_size,R_mm,wt_lbs,wt_kg,note";
// SEA prints a second inch value in column G; only listed columns may use raw2.
const OPTS = { raw2Columns: ["G"] };
const GOOD = [
  HEADER,
  "SEA 101,1,,1,25,15,381,3/4,raw2:0.75,*,*,*,*,*,4,1.8,",
  "SEA 107,2,,3 1/2,89,40.5,1029,TODO,TODO,4,11/16,17,3/8,10,50,22.7,G unreadable",
  'SEA 108,2,S,4,102,47.5,1207,2.38,60,8,11/16,17,1/2,13,72,32.7,"quoted, with a comma"',
].join("\r\n");

test("expectedHeader derives the column set", () => {
  assert.equal(expectedHeader(COLUMNS).join(","), HEADER);
});

test("a good fixture parses", () => {
  const rows = loadSizesCsv(GOOD, COLUMNS, undefined, OPTS);
  assert.equal(rows.length, 3);
  const [r1, r2, r3] = rows;
  assert.equal(r1.partNo, "SEA 101");
  assert.equal(r1.fig, "1");
  assert.deepEqual(r1.bore, { kind: "pair", in: "1", mm: 25 });
  assert.deepEqual(r1.dims.A, { kind: "pair", in: "15", mm: 381 });
  assert.deepEqual(r1.dims.G, {
    kind: "pair",
    in: "3/4",
    mm: null,
    raw2: "0.75",
  });
  assert.deepEqual(r1.dims.N, { kind: "na" });
  assert.deepEqual(r1.dims.R, { kind: "na" });
  assert.deepEqual(r1.wt, {
    lbs: { kind: "num", value: 4 },
    kg: { kind: "num", value: 1.8 },
  });
  assert.equal(r1.note, "");

  assert.deepEqual(r2.bore, { kind: "pair", in: "3 1/2", mm: 89 });
  assert.deepEqual(r2.dims.G, { kind: "todo" });
  assert.deepEqual(r2.dims.N, {
    kind: "holes",
    count: 4,
    dia: "11/16",
    mm: 17,
  });
  assert.deepEqual(r2.dims.R, { kind: "bolt", size: "3/8", mm: 10 });

  assert.equal(r3.markers, "S");
  assert.deepEqual(r3.dims.G, { kind: "pair", in: "2.38", mm: 60 });
});

test("quoted commas and escaped quotes are handled", () => {
  const rows = loadSizesCsv(GOOD, COLUMNS, undefined, OPTS);
  assert.equal(rows[2].note, "quoted, with a comma");
  assert.deepEqual(
    parseCsv('a,"b ""x"", c",d\n').map((r) => r.fields),
    [["a", 'b "x", c', "d"]],
  );
});

test("a UTF-8 BOM is stripped", () => {
  const rows = loadSizesCsv("﻿" + GOOD, COLUMNS, undefined, OPTS);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].partNo, "SEA 101");
});

test("inch values never keep the inch symbol", () => {
  const bad = GOOD.replace("3/4,raw2", '"3/4""",raw2');
  assert.throws(
    () => loadSizesCsv(bad, COLUMNS, undefined, OPTS),
    /column G_in: invalid value "3\/4""/,
  );
});

test("a header mismatch throws", () => {
  const bad = GOOD.replace("G_in,G_mm", "G_mm,G_in");
  assert.throws(() => loadSizesCsv(bad, COLUMNS, undefined, OPTS), /header mismatch/);
  assert.throws(
    () => loadSizesCsv(GOOD, COLUMNS.slice(0, 3), undefined, OPTS),
    /header mismatch/,
  );
});

test("an Excel-mangled fixture (BOM + 03-Apr) throws with row, column and value", () => {
  const mangled = "﻿" + GOOD.replace("3/4,raw2:0.75", "03-Apr,raw2:0.75");
  assert.throws(
    () => loadSizesCsv(mangled, COLUMNS, "sizes/sea.csv", OPTS),
    (err) => {
      assert.match(
        err.message,
        /sizes\/sea\.csv line 2 \(SEA 101\), column G_in: invalid value "03-Apr"/,
      );
      return true;
    },
  );
});

test("non-numeric mm, weight and count cells throw", () => {
  assert.throws(
    () => loadSizesCsv(GOOD.replace("15,381", "15,381mm"), COLUMNS, undefined, OPTS),
    /column A_mm/,
  );
  assert.throws(
    () => loadSizesCsv(GOOD.replace(",4,1.8,", ",4 lbs,1.8,"), COLUMNS, undefined, OPTS),
    /column wt_lbs/,
  );
  assert.throws(
    () =>
      loadSizesCsv(GOOD.replace("4,11/16,17,3/8", "4X,11/16,17,3/8"), COLUMNS, undefined, OPTS),
    /column N_count/,
  );
});

test("contradictory cells throw", () => {
  // mm printed but inch value is "*"
  assert.throws(
    () => loadSizesCsv(GOOD.replace("15,381", "*,381"), COLUMNS, undefined, OPTS),
    /column A_mm/,
  );
  // raw2 is only valid in pair mm cells
  assert.throws(
    () => loadSizesCsv(GOOD.replace(",4,1.8,", ",4,raw2:1.8,"), COLUMNS, undefined, OPTS),
    /column wt_kg/,
  );
});

test("a wrong field count throws", () => {
  assert.throws(
    () => loadSizesCsv(GOOD.replace(",4,1.8,", ",4,1.8,,"), COLUMNS, undefined, OPTS),
    /expected 17 fields, found 18/,
  );
});

test("text after a closing quote throws", () => {
  assert.throws(() => parseCsv('a,"b"x,c\n'), /unexpected text after a closing quote/);
  assert.throws(() => parseCsv('a,"b" ,c\n'), /unexpected text after a closing quote/);
  // delimiter, line break or end of input after the quote is fine
  assert.deepEqual(
    parseCsv('"a","b"\r\n"c"').map((r) => r.fields),
    [["a", "b"], ["c"]],
  );
  const bad = GOOD.replace('"quoted, with a comma"', '"quoted, with a comma" trailing');
  assert.throws(() => loadSizesCsv(bad, COLUMNS, undefined, OPTS), /closing quote/);
});

test("zero and invalid fractions throw", () => {
  for (const [value, why] of [
    ["1/0", /zero denominator/],
    ["1 1/0", /zero denominator/],
    ["0/4", /zero numerator/],
    ["1 0/4", /zero numerator/],
    ["5/4", /improper fraction/],
    ["1 4/4", /improper fraction/],
  ]) {
    assert.throws(
      () => loadSizesCsv(GOOD.replace("3/4,raw2", `${value},raw2`), COLUMNS, undefined, OPTS),
      (err) => {
        assert.match(err.message, /column G_in/);
        assert.match(err.message, why);
        return true;
      },
      value,
    );
  }
  assert.throws(
    () => loadSizesCsv(GOOD.replace("4,11/16,17,3/8", "4,0/16,17,3/8"), COLUMNS, undefined, OPTS),
    /column N_dia.*zero numerator/,
  );
});

test("zero values throw: inches, mm, weights, hole counts, raw2", () => {
  const cases = [
    [GOOD.replace("SEA 101,1,,1,25", "SEA 101,1,,0,25"), /column bore_in.*greater than zero/],
    [GOOD.replace("SEA 101,1,,1,25", "SEA 101,1,,0.0,25"), /column bore_in.*greater than zero/],
    [GOOD.replace("15,381", "15,0"), /column A_mm.*greater than zero/],
    [GOOD.replace(",4,1.8,", ",0,1.8,"), /column wt_lbs.*greater than zero/],
    [GOOD.replace(",4,1.8,", ",4,0.0,"), /column wt_kg.*greater than zero/],
    [GOOD.replace("4,11/16,17,3/8", "0,11/16,17,3/8"), /column N_count.*greater than zero/],
    [GOOD.replace("raw2:0.75", "raw2:0"), /column G_mm.*raw2 must be greater than zero/],
  ];
  for (const [text, re] of cases)
    assert.throws(() => loadSizesCsv(text, COLUMNS, undefined, OPTS), re);
});

test("raw2 is accepted only in columns listed in raw2Columns", () => {
  // G listed: accepted (see the good fixture). Not listed: rejected.
  assert.throws(
    () => loadSizesCsv(GOOD, COLUMNS),
    /column G_mm: invalid value "raw2:0\.75" \(raw2 is not allowed in column G/,
  );
  // A pair column that is not listed, even when another column is.
  assert.throws(
    () => loadSizesCsv(GOOD.replace("15,381", "15,raw2:15"), COLUMNS, undefined, OPTS),
    /column A_mm.*raw2 is not allowed in column A/,
  );
  // The bore pair is a column like any other.
  assert.throws(
    () => loadSizesCsv(GOOD.replace("SEA 101,1,,1,25", "SEA 101,1,,1,raw2:1.0"), COLUMNS, undefined, OPTS),
    /column bore_mm.*raw2 is not allowed in column bore/,
  );
  // raw2Columns must name a pair column.
  assert.throws(
    () => loadSizesCsv(GOOD, COLUMNS, undefined, { raw2Columns: ["N"] }),
    /raw2Columns lists "N", which is not a pair column/,
  );
  assert.throws(
    () => loadSizesCsv(GOOD, COLUMNS, undefined, { raw2Columns: ["Z"] }),
    /raw2Columns lists "Z"/,
  );
});

test("an Excel-mangled fixture still fails with raw2Columns set", () => {
  const mangled = "﻿" + GOOD.replace("11/16,17,3/8", "Nov-16,17,3/8");
  assert.throws(
    () => loadSizesCsv(mangled, COLUMNS, "sizes/sea.csv", OPTS),
    /sizes\/sea\.csv line 3 \(SEA 107\), column N_dia: invalid value "Nov-16"/,
  );
});
