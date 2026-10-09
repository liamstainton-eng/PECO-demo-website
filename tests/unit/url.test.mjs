import { test } from "node:test";
import assert from "node:assert/strict";
import { url, stripBase } from "../../src/lib/url.ts";

const GH = "/PECO-demo-website";

test("root base leaves site paths unchanged", () => {
  for (const base of ["/", ""]) {
    assert.equal(url("/", base), "/");
    assert.equal(url("/products", base), "/products");
    assert.equal(url("/products/sea", base), "/products/sea");
    assert.equal(url("/pricing#residential", base), "/pricing#residential");
    assert.equal(
      url("/quote?model=sea&size=SEA%20104", base),
      "/quote?model=sea&size=SEA%20104",
    );
    assert.equal(url("/favicon.svg", base), "/favicon.svg");
  }
});

test("subpath base prefixes site paths, with or without a trailing slash", () => {
  for (const base of [GH, `${GH}/`]) {
    assert.equal(url("/", base), `${GH}/`);
    assert.equal(url("/products", base), `${GH}/products`);
    assert.equal(
      url("/products/spark-arrestors", base),
      `${GH}/products/spark-arrestors`,
    );
    assert.equal(
      url("/pricing#residential", base),
      `${GH}/pricing#residential`,
    );
    assert.equal(url("/quote?model=sea", base), `${GH}/quote?model=sea`);
    assert.equal(url("/og-default.jpg", base), `${GH}/og-default.jpg`);
  }
});

test("fragments, protocol URLs and relative references are untouched", () => {
  const untouched = [
    "#pricing",
    "mailto:sales@pecoindustrial.co.uk?subject=Quote%20request",
    "tel:01513430330",
    "https://www.pecoindustrial.co.uk/products",
    "http://example.com/",
    "data:image/png;base64,AAAA",
    "//cdn.example.com/x.js",
    "products/sea",
    "",
  ];
  for (const base of ["/", GH, `${GH}/`]) {
    for (const href of untouched)
      assert.equal(url(href, base), href, `${href} with base ${base}`);
  }
});

test("stripBase removes the base from a pathname", () => {
  assert.equal(stripBase("/products/sea", "/"), "/products/sea");
  assert.equal(stripBase("/", "/"), "/");
  for (const base of [GH, `${GH}/`]) {
    assert.equal(stripBase(GH, base), "/");
    assert.equal(stripBase(`${GH}/`, base), "/");
    assert.equal(stripBase(`${GH}/products/sea`, base), "/products/sea");
    assert.equal(stripBase(`${GH}/products.html`, base), "/products.html");
    // A path that only shares a prefix with the base is not under it.
    assert.equal(stripBase(`${GH}-other/x`, base), `${GH}-other/x`);
    assert.equal(stripBase("/products", base), "/products");
  }
});

test("stripBase inverts url for site paths", () => {
  for (const base of ["/", GH]) {
    for (const p of ["/", "/products", "/products/sea", "/404"]) {
      assert.equal(stripBase(url(p, base), base), p);
    }
  }
});
