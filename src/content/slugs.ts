// Frozen URL slugs (plan T2a). Pages, redirects and the quote flow depend on
// these; changing one is a breaking change to the public URL map.

export const PRODUCT_SLUGS = [
  "sea",
  "se20",
  "se30",
  "se30-abs",
  "se40",
  "se50",
  "sls",
  "sa1",
  "sa2",
] as const;

export const CATEGORY_SLUGS = [
  "residential",
  "critical",
  "industrial",
  "spark-arrestors",
] as const;

export type ProductSlug = (typeof PRODUCT_SLUGS)[number];
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

// Provisional grouping taken from the old site menu. TODO(client): confirm category grouping.
export const CATEGORY_PRODUCTS: Readonly<
  Record<CategorySlug, readonly ProductSlug[]>
> = {
  residential: ["sea", "se30", "se30-abs", "se40"],
  critical: ["se50"],
  industrial: ["sls", "se20"],
  "spark-arrestors": ["sa1", "sa2"],
};
