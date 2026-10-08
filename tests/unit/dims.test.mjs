import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boreRange,
  formatInches,
  formatMm,
  lbsMatchesKg,
  mmMatchesInches,
  parseInches,
} from "../../src/lib/dims.ts";

test("parseInches handles mixed numbers, fractions and decimals", () => {
  assert.equal(parseInches("1 1/2"), 1.5);
  assert.equal(parseInches("3/4"), 0.75);
  assert.equal(parseInches("11/16"), 0.6875);
  assert.equal(parseInches("1.25"), 1.25);
  assert.equal(parseInches("10"), 10);
  assert.equal(parseInches("*"), null);
  assert.equal(parseInches("TODO"), null);
  assert.equal(parseInches("03-Apr"), null);
  assert.equal(parseInches("1/0"), null);
});

test("formatting adds units", () => {
  assert.equal(formatInches("1 1/2"), '1 1/2"');
  assert.equal(formatInches("3/4"), '3/4"');
  assert.equal(formatMm(381), "381 mm");
});

test("mm tolerance is ±1.5 mm or 2%", () => {
  assert.equal(mmMatchesInches(1, 25), true); // 25.4
  assert.equal(mmMatchesInches(12.5, 318), true); // 317.5
  assert.equal(mmMatchesInches(1, 27), false); // 1.6 mm off, 6%
  assert.equal(mmMatchesInches(100, 2590), true); // 2540, 1.97%
  assert.equal(mmMatchesInches(100, 2600), false); // 2.4%
});

test("weight tolerance is ±3%", () => {
  assert.equal(lbsMatchesKg(4, 1.8), true);
  assert.equal(lbsMatchesKg(8, 3.6), true);
  assert.equal(lbsMatchesKg(3, 1), false);
});

test("boreRange returns the smallest and largest bore", () => {
  const rows = [
    { bore: { kind: "pair", in: "1 1/2", mm: 38 } },
    { bore: { kind: "pair", in: "1", mm: 25 } },
    { bore: { kind: "todo" } },
    { bore: { kind: "pair", in: "8", mm: 203 } },
  ];
  assert.deepEqual(boreRange(rows), {
    minIn: "1",
    maxIn: "8",
    minMm: 25,
    maxMm: 203,
  });
  assert.equal(boreRange([{ bore: { kind: "na" } }]), null);
});
