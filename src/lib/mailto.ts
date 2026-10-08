// Builds "Get a quote" links. Pure (no imports) so it is unit-testable with
// `node --test`. Callers pass the configured cta.quoteHref as `base`
// (see getQuoteHref in ./config.ts).

export interface QuoteOptions {
  /** Display model name, e.g. "SEA" or "SE30 ABS". Used in the mailto subject. */
  model?: string;
  /** Model slug, e.g. "se30-abs". Used for the /quote query string (M2). */
  slug?: string;
  /** Size / part number, e.g. "SEA 104". */
  size?: string;
  /** Optional mailto body. Truncated so the whole link stays within MAX_MAILTO_LENGTH. */
  body?: string;
}

export const MAX_MAILTO_LENGTH = 1500;
const ELLIPSIS = "...";

const enc = (value: string): string => encodeURIComponent(value);

function subjectFor(model?: string, size?: string): string {
  const m = model?.trim() ?? "";
  const s = size?.trim() ?? "";
  // Part numbers usually start with the model ("SEA 104"); avoid "SEA SEA 104".
  const parts =
    s && m && s.toUpperCase().startsWith(m.toUpperCase()) ? [s] : [m, s];
  const detail = parts.filter(Boolean).join(" ");
  return detail ? `Quote request: ${detail}` : "Quote request";
}

function buildMailto(address: string, subject: string, body?: string): string {
  const head = `${address}?subject=${enc(subject)}`;
  if (!body) return head;

  const full = `${head}&body=${enc(body)}`;
  if (full.length <= MAX_MAILTO_LENGTH) return full;

  // Trim the body by code points (never split a surrogate pair) until it fits.
  const chars = Array.from(body);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${head}&body=${enc(chars.slice(0, mid).join("") + ELLIPSIS)}`;
    if (candidate.length <= MAX_MAILTO_LENGTH) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return head;
  return `${head}&body=${enc(chars.slice(0, lo).join("") + ELLIPSIS)}`;
}

/**
 * Returns the quote link for a product / size.
 * - `base` starting with `mailto:` (M1): mailto with a prefilled subject and optional body, <= 1500 chars.
 * - otherwise (M2, e.g. `/quote`): `/quote?model=<slug>&size=<partNo>`.
 */
export function quoteHref(
  opts: QuoteOptions = {},
  base = "mailto:sales@pecoindustrial.co.uk",
): string {
  const { model, slug, size, body } = opts;

  if (base.startsWith("mailto:")) {
    const address = base.split("?")[0];
    if (!model && !size && !body) return address;
    return buildMailto(address, subjectFor(model, size), body);
  }

  const params: string[] = [];
  const modelParam = slug ?? model;
  if (modelParam) params.push(`model=${enc(modelParam)}`);
  if (size) params.push(`size=${enc(size)}`);
  return params.length ? `${base}?${params.join("&")}` : base;
}
