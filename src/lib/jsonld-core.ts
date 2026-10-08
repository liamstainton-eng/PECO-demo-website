// Pure JSON-LD builders. No imports, so they run under `node --test`
// (config.ts imports YAML via ?raw, which plain Node cannot load).
// The Astro-facing API with the site config wired in is in ./jsonld.ts.
// Product is entity-only by design (ADR): no offers, no ratings.

export interface JsonLdContext {
  /** Site origin with no trailing slash, e.g. https://www.pecoindustrial.co.uk */
  site: string;
  name: string;
  email: string;
  /** International format, e.g. "+44 151 343 0330" */
  telephone: string;
  address: {
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
  };
}

export interface ProductLdInput {
  name: string;
  model: string;
  description: string;
  path: string;
  image?: string;
  category: string;
  attenuationDbA: number | null;
}

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

/** Site-relative path (or absolute URL) to an absolute URL on the site. */
export function absoluteUrl(site: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.replace(/\/+$/, "");
  return trimSlash(site) + (p === "" || p.startsWith("/") ? p : `/${p}`);
}

/** Serialise for embedding in <script type="application/ld+json">; "</" becomes "<\/". */
export function serializeJsonLd(data: object | object[]): string {
  return JSON.stringify(data).replace(/<\//g, "<\\/");
}

const orgId = (site: string): string => `${trimSlash(site)}/#organization`;
const businessId = (site: string): string => `${trimSlash(site)}/#business`;
const logoUrl = (site: string): string => `${trimSlash(site)}/logo.png`;
const addressLd = (ctx: JsonLdContext) => ({
  "@type": "PostalAddress",
  ...ctx.address,
});

export function organizationLd(ctx: JsonLdContext): object {
  const site = trimSlash(ctx.site);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": orgId(site),
    name: ctx.name,
    url: site,
    logo: logoUrl(site),
    email: ctx.email,
    telephone: ctx.telephone,
    address: addressLd(ctx),
  };
}

export function localBusinessLd(ctx: JsonLdContext): object {
  const site = trimSlash(ctx.site);
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": businessId(site),
    name: ctx.name,
    url: site,
    image: `${site}/og-default.jpg`,
    telephone: ctx.telephone,
    address: addressLd(ctx),
    parentOrganization: { "@id": orgId(site) },
  };
}

export function breadcrumbLd(
  ctx: Pick<JsonLdContext, "site">,
  items: { name: string; path: string }[],
): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(ctx.site, it.path),
    })),
  };
}

export function productLd(
  ctx: Pick<JsonLdContext, "site">,
  p: ProductLdInput,
): object {
  const site = trimSlash(ctx.site);
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    model: p.model,
    description: p.description,
    url: absoluteUrl(site, p.path),
    category: p.category,
    brand: { "@type": "Brand", name: "Peco" },
    manufacturer: { "@id": orgId(site) },
  };
  if (p.image) ld.image = absoluteUrl(site, p.image);
  if (p.attenuationDbA !== null) {
    ld.additionalProperty = [
      {
        "@type": "PropertyValue",
        name: "Noise attenuation",
        value: p.attenuationDbA,
        unitText: "dB(A)",
      },
    ];
  }
  return ld;
}
