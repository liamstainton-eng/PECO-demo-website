// Data helpers for the product pages (/products, category and product views).
// Everything shown comes from the content collections; nothing here adds facts.
import { getCollection, getEntry } from "astro:content";
import type { CollectionEntry } from "astro:content";
import type { ImageMetadata } from "astro";
import type { SizeRow } from "../../lib/csv";
import { boreRange, formatInches } from "../../lib/dims";
import { LAUNCH } from "../../lib/config";
import { CATEGORY_PRODUCTS } from "../../content/slugs";

export type Product = CollectionEntry<"products">;
export type Category = CollectionEntry<"categories">;

export const TODO_MARKER = "TODO(client)";

/** Staging-only highlight for unresolved client copy (never rendered in launch mode). */
export const TODO_MARK_CLASS =
  "rounded-[2px] bg-[#fff1b8] px-1 text-ink outline-1 outline-offset-1 outline-dashed outline-[#8a6100] [box-decoration-break:clone]";

export const productHref = (slug: string): string => `/products/${slug}`;

/** Categories in display order. */
export async function getCategories(): Promise<Category[]> {
  const all = await getCollection("categories");
  return all.sort((a, b) => a.data.order - b.data.order);
}

/** Position of a product within its category (frozen slug list), for stable ordering. */
function slugIndex(p: Product): number {
  const list = (CATEGORY_PRODUCTS as Record<string, readonly string[]>)[
    p.data.category.id
  ];
  const i = list ? list.indexOf(p.id) : -1;
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/** All products, ordered by category order and then by the frozen category listing. */
export async function getProducts(categories?: Category[]): Promise<Product[]> {
  const cats = categories ?? (await getCategories());
  const order = new Map(cats.map((c) => [c.id, c.data.order]));
  const all = await getCollection("products");
  return all.sort(
    (a, b) =>
      (order.get(a.data.category.id) ?? 99) -
        (order.get(b.data.category.id) ?? 99) ||
      slugIndex(a) - slugIndex(b) ||
      a.id.localeCompare(b.id),
  );
}

export const productsIn = (
  category: Category,
  products: Product[],
): Product[] => products.filter((p) => p.data.category.id === category.id);

/** Size-table rows for a product, or null when it has none. */
export async function getSizeRows(p: Product): Promise<SizeRow[] | null> {
  if (!p.data.sizes) return null;
  const entry = await getEntry(p.data.sizes);
  return entry?.data.rows ?? null;
}

export interface BoreSummary {
  inches: string;
  mm: string | null;
  /** Derived from fixture rows only (staging). Never set in launch mode. */
  fixture: boolean;
}

/**
 * Bore range derived from the size table. Fixture rows are a sample, so their
 * range is shown in staging only (flagged) and suppressed in launch mode.
 */
export function summariseBore(
  p: Product,
  rows: SizeRow[] | null,
): BoreSummary | null {
  const status = p.data.sizesStatus;
  if (!rows || (status !== "verified" && status !== "fixture")) return null;
  if (status === "fixture" && LAUNCH) return null;
  const r = boreRange(rows);
  if (!r) return null;
  const inches =
    r.minIn === r.maxIn
      ? formatInches(r.minIn)
      : `${formatInches(r.minIn)}–${formatInches(r.maxIn)}`;
  const mm =
    r.minMm !== null && r.maxMm !== null
      ? r.minMm === r.maxMm
        ? `${r.minMm} mm`
        : `${r.minMm}–${r.maxMm} mm`
      : null;
  return { inches, mm, fixture: status === "fixture" };
}

/** Splits prose at the first TODO(client) marker. */
export function splitTodo(text: string): {
  before: string;
  todo: string | null;
} {
  const i = text.indexOf(TODO_MARKER);
  if (i < 0) return { before: text, todo: null };
  return { before: text.slice(0, i).trimEnd(), todo: text.slice(i) };
}

export const hasTodo = (text: string): boolean => text.includes(TODO_MARKER);

const capitalise = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

/** Material and finish, only when the product description states them. */
export function materialAndFinish(description: string[]): {
  material: string | null;
  finish: string | null;
} {
  const text = description.filter((d) => !hasTodo(d)).join(" ");
  const m = /constructed in ([a-z][a-z ]*?)\s*[,.]/i.exec(text);
  const f = /finished with ([a-z][a-z ]*?)(?:\s+to\s|\s*[,.])/i.exec(text);
  return {
    material: m ? capitalise(m[1]) : null,
    finish: f ? capitalise(f[1]) : null,
  };
}

// Cropped dimension drawings: src/assets/images/products/<slug>-drawing.png
const crops = import.meta.glob<{ default: ImageMetadata }>(
  "/src/assets/images/products/*-drawing.png",
  { eager: true },
);

export function drawingCrop(slug: string): ImageMetadata | undefined {
  return crops[`/src/assets/images/products/${slug}-drawing.png`]?.default;
}

/** "Dimension drawing of the SEA silencer showing dimensions A to R". */
export function cropAlt(p: Product): string {
  const letters = (p.data.columns ?? []).map((c) => c.label.charAt(0));
  const base = `Dimension drawing of the ${p.data.model} silencer`;
  if (letters.length < 2) return base;
  return `${base} showing dimensions ${letters[0]} to ${letters[letters.length - 1]}`;
}

const escapeAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Applies the TODO(client) rule to rendered Markdown paragraphs.
 * Staging: the marker and the rest of the paragraph are highlighted.
 * Launch: a paragraph that is only a TODO note is dropped (editorial note);
 * an inline TODO becomes "Details to follow. Ask us" with a quote link.
 */
export function applyTodoRuleToHtml(html: string, quoteHref: string): string {
  return html.replace(/<p>([\s\S]*?)<\/p>/g, (whole, inner: string) => {
    const i = inner.indexOf(TODO_MARKER);
    if (i < 0) return whole;
    const before = inner.slice(0, i).trimEnd();
    if (LAUNCH) {
      if (before === "") return "";
      return `<p>${before} Details to follow. <a class="link" href="${escapeAttr(quoteHref)}">Ask us</a></p>`;
    }
    return `<p>${before}${before ? " " : ""}<mark class="${TODO_MARK_CLASS}" title="${TODO_MARKER}">${inner.slice(i)}</mark></p>`;
  });
}

/** Plain-text paragraphs as HTML (fallback when no rendered Markdown is available). */
export function paragraphsToHtml(body: string): string {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    )
    .join("\n");
}
