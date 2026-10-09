import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsBlockers,
  approvalBlockers,
  launchBlockers,
  pricingBlockers,
  productBlockers,
} from "../../scripts/lib/launch-rules.mjs";

const verified = (extra = {}) => ({
  sizesStatus: "verified",
  verification: {
    method: "double-blind",
    disputes: 0,
    humanSpotCheck: true,
    clientApproved: true,
  },
  expectedRows: 12,
  ...extra,
});

const pricing = (basis, price) => ({
  basis,
  grades: [{ category: "industrial", label: "Industrial", fromPrice: null }],
  products: { sea: { bands: ["small"], prices: { small: price } } },
});

test("approvalBlockers: only approved: true passes", () => {
  assert.deepEqual(
    approvalBlockers([
      { collection: "categories", id: "critical", approved: true },
      { collection: "categories", id: "industrial", approved: false },
      { collection: "legal", id: "privacy", approved: undefined },
      { collection: "legal", id: "terms", approved: "true" },
    ]),
    [
      "categories/industrial: approved is false, must be true",
      "legal/privacy: approved is null, must be true",
      'legal/terms: approved is "true", must be true',
    ],
  );
});

test("productBlockers: fixture and pending tables never ship", () => {
  const out = productBlockers([
    { id: "sea", data: verified({ sizesStatus: "fixture" }), csvRows: 3 },
    {
      id: "se20",
      data: { sizesStatus: "pending-transcription", verification: null },
      csvRows: null,
    },
  ]);
  assert.deepEqual(out, [
    'products/sea: sizesStatus is "fixture"',
    'products/se20: sizesStatus is "pending-transcription"',
  ]);
});

test("productBlockers: a shipped table needs client-approved verification and the expected rows", () => {
  assert.deepEqual(
    productBlockers([{ id: "sea", data: verified(), csvRows: 12 }]),
    [],
  );
  assert.deepEqual(
    productBlockers([
      { id: "a", data: verified({ verification: null }), csvRows: 12 },
    ]),
    ["products/a: size table has verification: null"],
  );
  assert.deepEqual(
    productBlockers([
      {
        id: "b",
        data: verified({
          verification: { ...verified().verification, clientApproved: false },
        }),
        csvRows: 12,
      },
    ]),
    ["products/b: size table verification.clientApproved is not true"],
  );
  assert.deepEqual(
    productBlockers([
      { id: "c", data: verified({ expectedRows: undefined }), csvRows: 12 },
    ]),
    ["products/c: size table has no expectedRows"],
  );
  assert.deepEqual(
    productBlockers([{ id: "d", data: verified(), csvRows: 3 }]),
    ["products/d: size CSV has 3 row(s), expectedRows is 12"],
  );
  assert.deepEqual(
    productBlockers([{ id: "e", data: verified(), csvRows: null }]),
    ["products/e: no size CSV"],
  );
});

test("productBlockers: no table only with an explicit launchException", () => {
  const none = (launchException) => ({
    sizesStatus: "none",
    verification: null,
    ...(launchException === undefined ? {} : { launchException }),
  });
  assert.match(
    productBlockers([{ id: "sa2", data: none(), csvRows: null }])[0],
    /^products\/sa2: sizesStatus is "none" with no launchException/,
  );
  assert.equal(
    productBlockers([{ id: "sa2", data: none("   "), csvRows: null }]).length,
    1,
  );
  assert.equal(
    productBlockers([{ id: "sa2", data: none(true), csvRows: null }]).length,
    1,
  );
  assert.deepEqual(
    productBlockers([
      {
        id: "sa2",
        data: none(
          "Client approved 2026-11-01: no datasheet exists; quote on request.",
        ),
        csvRows: null,
      },
    ]),
    [],
  );
});

test("analyticsBlockers: a configured provider needs a token", () => {
  assert.equal(
    analyticsBlockers({ analytics: { provider: "cloudflare", token: "" } })
      .length,
    1,
  );
  assert.equal(
    analyticsBlockers({ analytics: { provider: "cloudflare", token: "  " } })
      .length,
    1,
  );
  assert.deepEqual(
    analyticsBlockers({ analytics: { provider: "cloudflare", token: "abc" } }),
    [],
  );
  assert.deepEqual(
    analyticsBlockers({ analytics: { provider: "none", token: "" } }),
    [],
  );
});

test("pricingBlockers: TODO(client) basis only blocks when a price is set", () => {
  const todo = "TODO(client): confirm what prices include";
  assert.deepEqual(pricingBlockers(pricing(todo, null)), []);
  assert.deepEqual(pricingBlockers(pricing(todo, 1250)), [
    "data/pricing.json: basis still contains TODO(client) while prices are set",
  ]);
  assert.deepEqual(pricingBlockers(pricing("Ex VAT, carbon steel.", 1250)), []);
  const gradePriced = pricing(todo, null);
  gradePriced.grades[0].fromPrice = 900;
  assert.equal(pricingBlockers(gradePriced).length, 1);
});

test("launchBlockers combines every rule", () => {
  const out = launchBlockers({
    approvals: [{ collection: "legal", id: "privacy", approved: false }],
    products: [{ id: "sea", data: { sizesStatus: "fixture" }, csvRows: 3 }],
    config: { analytics: { provider: "cloudflare", token: "" } },
    pricing: pricing("TODO(client)", 10),
  });
  assert.equal(out.length, 4);
  assert.deepEqual(
    launchBlockers({
      approvals: [{ collection: "legal", id: "privacy", approved: true }],
      products: [{ id: "sea", data: verified(), csvRows: 12 }],
      config: { analytics: { provider: "cloudflare", token: "t" } },
      pricing: pricing("Ex VAT", 10),
    }),
    [],
  );
});
