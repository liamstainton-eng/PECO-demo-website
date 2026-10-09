// Base-aware URLs. Internal paths in the source are site paths ("/products");
// url() turns one into the href for the current build. The default build has
// base "/" (no change); the GitHub Pages demo build (DEPLOY_TARGET=gh-pages)
// has base "/PECO-demo-website". Canonical, og:url and JSON-LD use the real
// domain and site paths, never url().
//
// `base` defaults to import.meta.env.BASE_URL; pass it explicitly outside Astro
// (astro.config.mjs, unit tests).

const trimBase = (base: string): string => base.replace(/\/+$/, "");

/**
 * Prefixes a site path with the base. Leaves fragments ("#x"), protocol URLs
 * (mailto:, tel:, https:, data:), protocol-relative ("//host") and relative
 * references unchanged.
 */
export function url(
  path: string,
  base: string = import.meta.env.BASE_URL,
): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return trimBase(base) + path;
}

/** Inverse of url() for a pathname: "/PECO-demo-website/products" -> "/products". */
export function stripBase(
  pathname: string,
  base: string = import.meta.env.BASE_URL,
): string {
  const b = trimBase(base);
  if (b === "") return pathname;
  if (pathname === b) return "/";
  return pathname.startsWith(`${b}/`) ? pathname.slice(b.length) : pathname;
}
