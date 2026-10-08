// JSON-LD builders with the site config wired in. The pure implementations
// (and their unit tests) live in ./jsonld-core.ts.
import { CONTACT, SITE } from "./config";
import * as core from "./jsonld-core";
import type { JsonLdContext, ProductLdInput } from "./jsonld-core";

export { absoluteUrl, serializeJsonLd } from "./jsonld-core";

// CONTACT.address is ["Peco Silencers Ltd", ...street lines, locality, region, postcode].
const lines = CONTACT.address;
const [, ...rest] = lines;
const postalCode = rest[rest.length - 1];
const addressRegion = rest[rest.length - 2];
const addressLocality = rest[rest.length - 3];
const streetAddress = rest.slice(0, -3).join(", ");

// "tel:01513430330" -> "+44 151 343 0330"
const national = CONTACT.phoneHref.replace(/^tel:/, "").replace(/^0/, "");
const telephone = `+44 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;

const ctx: JsonLdContext = {
  site: SITE.site.replace(/\/+$/, ""),
  name: SITE.name,
  email: CONTACT.email,
  telephone,
  address: { streetAddress, addressLocality, addressRegion, postalCode, addressCountry: "GB" },
};

export const organizationLd = (): object => core.organizationLd(ctx);
export const localBusinessLd = (): object => core.localBusinessLd(ctx);
export const breadcrumbLd = (items: { name: string; path: string }[]): object => core.breadcrumbLd(ctx, items);
export const productLd = (p: ProductLdInput): object => core.productLd(ctx, p);
