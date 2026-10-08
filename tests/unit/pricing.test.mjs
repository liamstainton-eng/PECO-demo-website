import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  allTiers,
  attenuationRange,
  bandCells,
  formatFrom,
  gradeTiers,
  hasAnyPrice,
  productTiers,
} from "../../src/lib/pricing-core.ts";
import { CATEGORY_SLUGS, PRODUCT_SLUGS } from "../../src/content/slugs.ts";

const DATA = JSON.parse(
  readFileSync(new URL("../../src/data/pricing.json", import.meta.url), "utf8"),
);

const BANDS = [
  { id: "small", label: "Small", boreRange: "up to 3 in", minIn: 0, maxIn: 3 },
  {
    id: "medium",
    label: "Medium",
    boreRange: "3½ in to 8 in",
    minIn: 3.5,
    maxIn: 8,
  },
  {
    id: "large",
    label: "Large",
    boreRange: "10 in to 20 in",
    minIn: 10,
    maxIn: 20,
  },
];

// Synthetic fixture: figures here are test values, not prices.
const fixture = {
  currency: "GBP",
  basis: "",
  bands: BANDS,
  grades: [
    { category: "residential", label: "Residential", fromPrice: null },
    { category: "industrial", label: "Industrial", fromPrice: 900 },
  ],
  products: {
    // Bands listed out of order on purpose: output follows PRICING.bands order.
    a: { bands: ["large", "small"], prices: { small: 100, large: null } },
    b: { bands: [], prices: {} },
  },
};

test("productTiers follows band order and keeps only the model's bands", () => {
  const tiers = productTiers(fixture, "a");
  assert.deepEqual(
    tiers.map((t) => t.id),
    ["small", "large"],
  );
  assert.deepEqual(tiers[0], {
    id: "small",
    label: "Small",
    detail: "up to 3 in",
    price: 100,
  });
  assert.equal(tiers[1].price, null);
});

test("productTiers is empty for a model with no bands or no entry", () => {
  assert.deepEqual(productTiers(fixture, "b"), []);
  assert.deepEqual(productTiers(fixture, "missing"), []);
});

test("bandCells marks unavailable bands and returns null with no bands", () => {
  assert.deepEqual(bandCells(fixture, "a"), [
    { id: "small", available: true, price: 100 },
    { id: "medium", available: false, price: null },
    { id: "large", available: true, price: null },
  ]);
  assert.equal(bandCells(fixture, "b"), null);
});

test("formatFrom: null stays null, figures become 'From £X'", () => {
  assert.equal(formatFrom(null), null);
  assert.equal(formatFrom(1250), "From £1,250");
  assert.equal(formatFrom(900), "From £900");
});

test("hasAnyPrice is true only when some tier has a figure", () => {
  assert.equal(hasAnyPrice([]), false);
  assert.equal(
    hasAnyPrice([{ id: "x", label: "X", detail: "", price: null }]),
    false,
  );
  assert.equal(hasAnyPrice(productTiers(fixture, "a")), true);
  assert.equal(hasAnyPrice(gradeTiers(fixture)), true);
});

test("allTiers covers grade and product tiers", () => {
  assert.equal(allTiers(fixture).length, 2 + 2);
});

test("attenuationRange derives the range and ignores unknown ratings", () => {
  assert.equal(attenuationRange([24, 24, null, 28]), "24–28 dB(A)");
  assert.equal(attenuationRange([32]), "32 dB(A)");
  assert.equal(attenuationRange([null]), null);
  assert.equal(attenuationRange([]), null);
});

test("pricing.json: every product slug has an entry, and no unknown slugs", () => {
  assert.deepEqual(
    Object.keys(DATA.products).sort(),
    [...PRODUCT_SLUGS].sort(),
  );
});

test("pricing.json: every category has a grade", () => {
  assert.deepEqual(
    DATA.grades.map((g) => g.category).sort(),
    [...CATEGORY_SLUGS].sort(),
  );
});

test("pricing.json: prices are keyed only by the model's own bands", () => {
  const bandIds = DATA.bands.map((b) => b.id);
  for (const [slug, entry] of Object.entries(DATA.products)) {
    for (const band of entry.bands) {
      assert.ok(bandIds.includes(band), `${slug}: unknown band ${band}`);
    }
    for (const key of Object.keys(entry.prices)) {
      assert.ok(
        entry.bands.includes(key),
        `${slug}: price for unlisted band ${key}`,
      );
    }
  }
});
