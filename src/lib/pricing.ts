// Indicative pricing tiers. Every figure comes from the client: a null price
// means "not supplied yet". Staging builds show the gap as TODO(client);
// launch builds hide unpriced tiers and fall back to "price on request".
// Bands follow the datasheet bore ranges for each model (src/data/pricing.json).
// The pure helpers (and their unit tests) live in ./pricing-core.ts.
import { z } from "zod";
import raw from "../data/pricing.json";
import { LAUNCH } from "./config";
import * as core from "./pricing-core";
import type { BandCell, PricingData, Tier } from "./pricing-core";

export type { BandCell, BandId, Tier } from "./pricing-core";
export { attenuationRange, formatFrom, hasAnyPrice } from "./pricing-core";

const BandId = z.enum(["small", "medium", "large"]);
const Price = z.number().positive().nullable();

const PricingSchema = z.object({
  currency: z.literal("GBP"),
  basis: z.string(),
  bands: z.array(
    z.object({
      id: BandId,
      label: z.string(),
      boreRange: z.string(),
      minIn: z.number(),
      maxIn: z.number(),
    }),
  ),
  grades: z.array(
    z.object({ category: z.string(), label: z.string(), fromPrice: Price }),
  ),
  products: z.record(
    z.string(),
    z.object({
      bands: z.array(BandId),
      prices: z.partialRecord(BandId, Price),
    }),
  ),
});

export const PRICING: PricingData = PricingSchema.parse(raw);

/** Size-band tiers for one product, in band order. Empty when the model has no size data. */
export const productTiers = (slug: string): Tier[] =>
  core.productTiers(PRICING, slug);

/** Grade tiers for the /pricing overview, keyed by category id. */
export const gradeTiers = (): Tier[] => core.gradeTiers(PRICING);

/** One cell per band for the size-band table; null when the model has no bands. */
export const bandCells = (slug: string): BandCell[] | null =>
  core.bandCells(PRICING, slug);

/**
 * Whether pricing is shown anywhere (nav links, "See pricing" buttons, product
 * pricing sections, tier figures on /pricing). Staging: always. Launch: only
 * once the client has supplied at least one real price.
 */
export const PRICING_LIVE: boolean =
  !LAUNCH || core.hasAnyPrice(core.allTiers(PRICING));
