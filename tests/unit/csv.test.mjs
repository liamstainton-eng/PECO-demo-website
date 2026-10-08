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
  const rows = loadSizesCsv(GOOD, COLUMNS);
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
  const rows = loadSizesCsv(GOOD, COLUMNS);
  assert.equal(rows[2].note, "quoted, with a comma");
  assert.deepEqual(
    parseCsv('a,"b ""x"", c",d\n').map((r) => r.fields),
    [["a", 'b "x", c', "d"]],
  );
});

test("a UTF-8 BOM is stripped", () => {
  const rows = loadSizesCsv("﻿" + GOOD, COLUMNS);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].partNo, "SEA 101");
});

test("inch values never keep the inch symbol", () => {
  const bad = GOOD.replace("3/4,raw2", '"3/4""",raw2');
  assert.throws(
    () => loadSizesCsv(bad, COLUMNS),
    /column G_in: invalid value "3\/4""/,
  );
});

test("a header mismatch throws", () => {
  const bad = GOOD.replace("G_in,G_mm", "G_mm,G_in");
  assert.throws(() => loadSizesCsv(bad, COLUMNS), /header mismatch/);
  assert.throws(
    () => loadSizesCsv(GOOD, COLUMNS.slice(0, 3)),
    /header mismatch/,
  );
});

test("an Excel-mangled fixture (BOM + 03-Apr) throws with row, column and value", () => {
  const mangled = "﻿" + GOOD.replace("3/4,raw2:0.75", "03-Apr,raw2:0.75");
  assert.throws(
    () => loadSizesCsv(mangled, COLUMNS, "sizes/sea.csv"),
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
    () => loadSizesCsv(GOOD.replace("15,381", "15,381mm"), COLUMNS),
    /column A_mm/,
  );
  assert.throws(
    () => loadSizesCsv(GOOD.replace(",4,1.8,", ",4 lbs,1.8,"), COLUMNS),
    /column wt_lbs/,
  );
  assert.throws(
    () =>
      loadSizesCsv(GOOD.replace("4,11/16,17,3/8", "4X,11/16,17,3/8"), COLUMNS),
    /column N_count/,
  );
});

test("contradictory cells throw", () => {
  // mm printed but inch value is "*"
  assert.throws(
    () => loadSizesCsv(GOOD.replace("15,381", "*,381"), COLUMNS),
    /column A_mm/,
  );
  // raw2 is only valid in pair mm cells
  assert.throws(
    () => loadSizesCsv(GOOD.replace(",4,1.8,", ",4,raw2:1.8,"), COLUMNS),
    /column wt_kg/,
  );
});

test("a wrong field count throws", () => {
  assert.throws(
    () => loadSizesCsv(GOOD.replace(",4,1.8,", ",4,1.8,,"), COLUMNS),
    /expected 17 fields, found 18/,
  );
});
