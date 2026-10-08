// Pure pricing helpers. No imports, so they run under `node --test`
// (the Astro-facing API with the validated data wired in is in ./pricing.ts).
// Every figure comes from the client: a null price means "not supplied yet".

export type BandId = "small" | "medium" | "large";

export interface Band {
  id: BandId;
  label: string;
  boreRange: string;
  minIn: number;
  maxIn: number;
}

export interface Grade {
  category: string;
  label: string;
  fromPrice: number | null;
}

export interface ProductPricing {
  bands: BandId[];
  prices: Partial<Record<BandId, number | null>>;
}

export interface PricingData {
  currency: "GBP";
  basis: string;
  bands: Band[];
  grades: Grade[];
  products: Record<string, ProductPricing>;
}

export interface Tier {
  id: string;
  label: string;
  detail: string;
  price: number | null;
}

/** One column of the size-band table: whether the model comes in that band, and its from-price. */
export interface BandCell {
  id: BandId;
  available: boolean;
  price: number | null;
}

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

/** "From £1,250", or null when the client has not supplied a figure. */
export const formatFrom = (price: number | null): string | null =>
  price === null ? null : `From ${gbp.format(price)}`;

/** Size-band tiers for one product, in band order. Empty when the model has no size data. */
export function productTiers(data: PricingData, slug: string): Tier[] {
  const entry = data.products[slug];
  if (!entry) return [];
  return data.bands
    .filter((band) => entry.bands.includes(band.id))
    .map((band) => ({
      id: band.id,
      label: band.label,
      detail: band.boreRange,
      price: entry.prices[band.id] ?? null,
    }));
}

/** Grade tiers for the /pricing overview, keyed by category id. */
export function gradeTiers(data: PricingData): Tier[] {
  return data.grades.map((grade) => ({
    id: grade.category,
    label: grade.label,
    detail: "",
    price: grade.fromPrice,
  }));
}

/** Every tier on the site: the grade tiers plus each product's size-band tiers. */
export function allTiers(data: PricingData): Tier[] {
  return [
    ...gradeTiers(data),
    ...Object.keys(data.products).flatMap((slug) => productTiers(data, slug)),
  ];
}

/** True when at least one tier has a real price, i.e. the section is worth showing in a launch build. */
export const hasAnyPrice = (tiers: Tier[]): boolean =>
  tiers.some((tier) => tier.price !== null);

/**
 * One cell per band (all bands, in band order) for the size-band table.
 * Null when the model has no bands at all (priced on request).
 */
export function bandCells(data: PricingData, slug: string): BandCell[] | null {
  const entry = data.products[slug];
  if (!entry || entry.bands.length === 0) return null;
  return data.bands.map((band) => {
    const available = entry.bands.includes(band.id);
    return {
      id: band.id,
      available,
      price: available ? (entry.prices[band.id] ?? null) : null,
    };
  });
}

/** "24–28 dB(A)" from the known ratings (nulls ignored), "32 dB(A)" when they agree, null when none. */
export function attenuationRange(values: (number | null)[]): string | null {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  return min === max ? `${min} dB(A)` : `${min}–${max} dB(A)`;
}
