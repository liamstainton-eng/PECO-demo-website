// Loads src/config.yaml and validates it with Zod. Replaces AstroWind's
// vendor/integration virtual module with a plain import.
import { parse } from "yaml";
import { z } from "astro/zod";
import raw from "../config.yaml?raw";
import { quoteHref } from "./mailto";
import type { QuoteOptions } from "./mailto";

const ConfigSchema = z.object({
  site: z.object({
    name: z.string().min(1),
    site: z.url(),
  }),
  metadata: z.object({
    title: z.object({
      default: z.string().min(1),
      template: z.string().includes("%s"),
    }),
    description: z.string().min(1),
    openGraph: z.object({
      site_name: z.string().min(1),
      type: z.string().default("website"),
      locale: z.string().default("en_GB"),
    }),
  }),
  contact: z.object({
    phoneDisplay: z.string().min(1),
    phoneHref: z.string().startsWith("tel:"),
    email: z.email(),
    address: z.array(z.string().min(1)).min(1),
    mapUrl: z.url(),
  }),
  cta: z.object({
    quoteLabel: z.string().min(1),
    quoteHref: z
      .string()
      .refine((v) => v.startsWith("mailto:") || v.startsWith("/"), {
        message:
          "cta.quoteHref must be a mailto: link or a site path such as /quote",
      }),
  }),
  analytics: z.object({
    provider: z.enum(["cloudflare", "ga4", "none"]),
    requiresConsent: z.boolean(),
    token: z.string(),
  }),
  turnstile: z.object({
    siteKey: z.string(),
  }),
});

export type SiteConfig = z.infer<typeof ConfigSchema>;

const config: SiteConfig = ConfigSchema.parse(parse(raw));

export const SITE = config.site;
export const METADATA = config.metadata;
export const CONTACT = config.contact;
export const CTA = config.cta;
export const ANALYTICS = config.analytics;
export const TURNSTILE = config.turnstile;

/** True only for the production build (LAUNCH=1 in the Cloudflare production env). */
export const LAUNCH = process.env.LAUNCH === "1";

/** Quote link for the configured CTA target (mailto in M1, /quote in M2). */
export const getQuoteHref = (opts: QuoteOptions = {}): string =>
  quoteHref(opts, CTA.quoteHref);

export default config;
