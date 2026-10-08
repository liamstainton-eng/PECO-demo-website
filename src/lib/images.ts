import type { ImageMetadata } from "astro";

/**
 * Filters requested responsive widths to those <= the image's intrinsic width,
 * so astro:assets never upscales. If any requested width was too large, the
 * intrinsic width is added as the largest candidate instead.
 */
export function capWidths(
  image: Pick<ImageMetadata, "width">,
  widths: number[],
): number[] {
  const max = image.width;
  const kept = widths.filter((w) => w > 0 && w <= max);
  if (widths.some((w) => w > max)) kept.push(max);
  return [...new Set(kept)].sort((a, b) => a - b);
}
