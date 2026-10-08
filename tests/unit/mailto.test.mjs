import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteHref, MAX_MAILTO_LENGTH } from "../../src/lib/mailto.ts";

const MAILTO = "mailto:sales@pecoindustrial.co.uk";

test("bare mailto when no product details", () => {
  assert.equal(quoteHref({}, MAILTO), MAILTO);
  assert.equal(quoteHref(), MAILTO);
});

test("subject includes model and size, URL-encoded", () => {
  assert.equal(
    quoteHref({ model: "SE30 ABS", size: "4in" }, MAILTO),
    `${MAILTO}?subject=Quote%20request%3A%20SE30%20ABS%204in`,
  );
});

test("size that already starts with the model is not doubled", () => {
  assert.equal(
    quoteHref({ model: "SEA", size: "SEA 104" }, MAILTO),
    `${MAILTO}?subject=Quote%20request%3A%20SEA%20104`,
  );
});

test("model only", () => {
  assert.equal(
    quoteHref({ model: "SLS" }, MAILTO),
    `${MAILTO}?subject=Quote%20request%3A%20SLS`,
  );
});

test("body is encoded and appended", () => {
  const href = quoteHref(
    { model: "SA1", body: 'Bore: 3"\nQty: 2 & more' },
    MAILTO,
  );
  assert.ok(href.includes("&body=Bore%3A%203%22%0AQty%3A%202%20%26%20more"));
});

test("long body is truncated so the link stays within the limit", () => {
  const body = "Engine details £ é 🔧 ".repeat(400);
  const href = quoteHref({ model: "SE50", size: "SE 506", body }, MAILTO);
  assert.ok(href.length <= MAX_MAILTO_LENGTH, `length ${href.length}`);
  const decoded = decodeURIComponent(href.split("&body=")[1]);
  assert.ok(decoded.endsWith("..."));
  assert.ok(body.startsWith(decoded.slice(0, -3)));
});

test("M2 /quote target uses slug and part number", () => {
  assert.equal(
    quoteHref({ model: "SEA", slug: "sea", size: "SEA 104" }, "/quote"),
    "/quote?model=sea&size=SEA%20104",
  );
  assert.equal(quoteHref({}, "/quote"), "/quote");
  assert.equal(
    quoteHref({ slug: "se30-abs" }, "/quote"),
    "/quote?model=se30-abs",
  );
});
