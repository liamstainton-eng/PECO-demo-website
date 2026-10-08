import { test } from "node:test";
import assert from "node:assert/strict";
import {
  organizationLd,
  localBusinessLd,
  breadcrumbLd,
  productLd,
  absoluteUrl,
  serializeJsonLd,
} from "../../src/lib/jsonld-core.ts";

const SITE = "https://www.pecoindustrial.co.uk";
const ctx = {
  site: SITE,
  name: "Peco Silencers Ltd",
  email: "sales@pecoindustrial.co.uk",
  telephone: "+44 151 343 0330",
  address: {
    streetAddress: "Unit 8, Wrynose Road, The Old Hall Estate",
    addressLocality: "Bromborough",
    addressRegion: "Wirral",
    postalCode: "CH62 3QD",
    addressCountry: "GB",
  },
};

const product = {
  name: "SE30 exhaust silencer",
  model: "SE30",
  description: "Residential silencer.",
  path: "/products/se30",
  image: "/images/se30.png",
  category: "Residential",
  attenuationDbA: 24,
};

test("organization has identity, logo and postal address", () => {
  const o = organizationLd(ctx);
  assert.equal(o["@type"], "Organization");
  assert.equal(o["@id"], `${SITE}/#organization`);
  assert.equal(o.name, "Peco Silencers Ltd");
  assert.equal(o.url, SITE);
  assert.equal(o.logo, `${SITE}/logo.png`);
  assert.equal(o.telephone, "+44 151 343 0330");
  assert.equal(o.email, "sales@pecoindustrial.co.uk");
  assert.deepEqual(o.address, { "@type": "PostalAddress", ...ctx.address });
});

test("organization carries no invented facts", () => {
  const o = organizationLd(ctx);
  for (const k of [
    "sameAs",
    "openingHours",
    "openingHoursSpecification",
    "aggregateRating",
    "offers",
  ]) {
    assert.ok(!(k in o), k);
  }
});

test("local business links to the organization", () => {
  const b = localBusinessLd(ctx);
  assert.equal(b["@type"], "LocalBusiness");
  assert.equal(b["@id"], `${SITE}/#business`);
  assert.deepEqual(b.parentOrganization, { "@id": `${SITE}/#organization` });
  assert.equal(b.name, "Peco Silencers Ltd");
  assert.equal(b.telephone, "+44 151 343 0330");
  assert.equal(b.image, `${SITE}/og-default.jpg`);
  assert.equal(b.address.postalCode, "CH62 3QD");
});

test("breadcrumb has 1-based positions and absolute item URLs", () => {
  const b = breadcrumbLd(ctx, [
    { name: "Home", path: "/" },
    { name: "Products", path: "/products" },
    { name: "SE30", path: "/products/se30/" },
  ]);
  assert.equal(b["@type"], "BreadcrumbList");
  assert.deepEqual(
    b.itemListElement.map((i) => [i.position, i.name, i.item]),
    [
      [1, "Home", SITE],
      [2, "Products", `${SITE}/products`],
      [3, "SE30", `${SITE}/products/se30`],
    ],
  );
  assert.ok(b.itemListElement.every((i) => i["@type"] === "ListItem"));
});

test("product is entity-only with absolute url and image", () => {
  const p = productLd(ctx, product);
  assert.equal(p["@type"], "Product");
  assert.equal(p.url, `${SITE}/products/se30`);
  assert.equal(p.image, `${SITE}/images/se30.png`);
  assert.equal(p.model, "SE30");
  assert.equal(p.category, "Residential");
  assert.deepEqual(p.brand, { "@type": "Brand", name: "Peco" });
  assert.deepEqual(p.manufacturer, { "@id": `${SITE}/#organization` });
  assert.deepEqual(p.additionalProperty, [
    {
      "@type": "PropertyValue",
      name: "Noise attenuation",
      value: 24,
      unitText: "dB(A)",
    },
  ]);
  assert.ok(!("offers" in p));
  assert.ok(!("aggregateRating" in p));
});

test("product with null attenuation omits additionalProperty", () => {
  const p = productLd(ctx, { ...product, attenuationDbA: null });
  assert.ok(!("additionalProperty" in p));
  assert.ok(!JSON.stringify(p).includes("Noise attenuation"));
});

test("product without image omits image; absolute image is kept", () => {
  assert.ok(!("image" in productLd(ctx, { ...product, image: undefined })));
  const abs = "https://www.pecoindustrial.co.uk/x.png";
  assert.equal(productLd(ctx, { ...product, image: abs }).image, abs);
});

test("attenuation of 0 is kept (not treated as missing)", () => {
  const p = productLd(ctx, { ...product, attenuationDbA: 0 });
  assert.equal(p.additionalProperty[0].value, 0);
});

test("absoluteUrl handles root, relative, trailing slash and a slashed site", () => {
  assert.equal(absoluteUrl(SITE, "/"), SITE);
  assert.equal(absoluteUrl(SITE + "/", "/about/"), `${SITE}/about`);
  assert.equal(absoluteUrl(SITE, "about"), `${SITE}/about`);
  assert.equal(
    absoluteUrl(SITE, "https://example.com/a"),
    "https://example.com/a",
  );
});

test("serializeJsonLd escapes the closing-tag sequence so the script cannot be broken out of", () => {
  const out = serializeJsonLd({
    description: "evil </script><script>alert(1)</script>",
  });
  assert.ok(!out.includes("</"));
  assert.ok(out.includes("<\\/script>"));
  assert.equal(
    JSON.parse(out).description,
    "evil </script><script>alert(1)</script>",
  );
});

test("serializeJsonLd accepts arrays", () => {
  assert.deepEqual(JSON.parse(serializeJsonLd([{ a: 1 }, { b: 2 }])), [
    { a: 1 },
    { b: 2 },
  ]);
});
