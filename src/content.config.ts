import { defineCollection, reference } from "astro:content";
import { file, glob } from "astro/loaders";
import { z } from "astro/zod";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inchProblem, loadSizesCsv } from "./lib/csv.ts";
import type { Column } from "./lib/csv.ts";
import { PRODUCT_SLUGS } from "./content/slugs.ts";

const columnSchema = z.strictObject({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),
  label: z.string().min(1),
  kind: z.enum(["pair", "holes", "bolt"]),
});

// ---- Size-table rows: the runtime shape produced by loadSizesCsv (src/lib/csv.ts),
// validated again here so a loader change cannot hand the pages a malformed row.

/** A positive inch value as printed: "1", "1.25", "3/4", "1 1/2" (never "*" or TODO). */
const inchValue = z
  .string()
  .regex(/^\d+(\s\d+\/\d+)?$|^\d+\/\d+$|^\d+(\.\d+)?$/)
  .refine((v) => inchProblem(v) === null, {
    message: "inch value must be positive with a proper, non-zero fraction",
  });
const mmValue = z.number().positive().nullable();
const naCell = z.strictObject({ kind: z.literal("na") });
const todoCell = z.strictObject({ kind: z.literal("todo") });
const pairValue = z.strictObject({
  kind: z.literal("pair"),
  in: inchValue,
  mm: mmValue,
  raw2: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .refine((v) => Number(v) > 0, { message: "raw2 must be positive" })
    .optional(),
});
const holesValue = z.strictObject({
  kind: z.literal("holes"),
  count: z.number().int().positive(),
  dia: inchValue,
  mm: mmValue,
});
const boltValue = z.strictObject({
  kind: z.literal("bolt"),
  size: inchValue,
  mm: mmValue,
});
const numValue = z.strictObject({
  kind: z.literal("num"),
  value: z.number().positive(),
});
const pairCell = z.discriminatedUnion("kind", [pairValue, naCell, todoCell]);
const dimCell = z.discriminatedUnion("kind", [
  pairValue,
  holesValue,
  boltValue,
  naCell,
  todoCell,
]);
const numCell = z.discriminatedUnion("kind", [numValue, naCell, todoCell]);
const sizeRowSchema = z.strictObject({
  partNo: z.string().min(1),
  fig: z.string().regex(/^\d+$/).nullable(),
  markers: z.string().regex(/^[A-Za-z*]*$/),
  bore: pairCell,
  dims: z.record(z.string().min(1), dimCell),
  wt: z.strictObject({ lbs: numCell, kg: numCell }),
  note: z.string(),
});

const products = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/products" }),
  schema: ({ image }) =>
    z
      .object({
        model: z.string().min(1),
        name: z.string().min(1),
        category: reference("categories"),
        // As printed on the datasheet, e.g. "SEA EXHAUST GAS SILENCER"; null when there is no datasheet.
        datasheetTitle: z.string().min(1).nullable(),
        attenuationDbA: z.number().nullable(),
        attenuationSource: z.enum(["datasheet", "page-copy", "todo"]),
        type: z.string().min(1).nullable(),
        summary: z.string().min(1),
        description: z.array(z.string().min(1)).min(1),
        options: z.array(z.string().min(1)), // verbatim from that model's datasheet
        // Relative to the JSON file, e.g. ../../assets/images/legacy/PECO-SEA-.png
        drawing: image().optional(),
        drawingAlt: z.string().min(1).optional(),
        columns: z.array(columnSchema).min(1).nullable(),
        figures: z
          .record(z.string().regex(/^\d+$/), z.string().min(1))
          .optional(), // {"1": "1–3 in screwed", "2": "3½–8 in flanged"}
        tableNotes: z.array(z.string().min(1)).default([]),
        sizes: reference("sizes").nullable(), // null when no CSV exists yet
        sizesStatus: z.enum([
          "verified",
          "fixture",
          "pending-transcription",
          "none",
        ]),
        // Pair columns whose _mm cell may hold `raw2:` (a second printed inch value), e.g. ["G"] for SEA.
        raw2Columns: z.array(z.string().min(1)).optional(),
        // Rows in the datasheet table; the CSV must match (check-products, check-launch).
        expectedRows: z.number().int().positive().optional(),
        // Client-approved reason for launching with sizesStatus "none" (check-launch).
        launchException: z.string().trim().min(1).optional(),
        verification: z
          .object({
            method: z.enum(["source-file", "double-blind"]),
            disputes: z.number().int().nonnegative(),
            humanSpotCheck: z.boolean(),
            clientApproved: z.boolean(),
          })
          .nullable()
          .default(null),
        related: z.array(reference("products")).default([]),
        seo: z.object({
          title: z.string().min(1).max(60),
          description: z.string().min(70).max(160),
        }),
      })
      // Status / file / verification invariants, in one place. check-products.mjs
      // repeats them without Astro so `npm run verify:data` reports them too.
      .superRefine((p, ctx) => {
        const issue = (path: string, message: string) =>
          ctx.addIssue({ code: "custom", path: [path], message });
        const hasTable =
          p.sizesStatus === "verified" || p.sizesStatus === "fixture";
        if (hasTable !== (p.sizes !== null))
          issue(
            "sizes",
            `sizesStatus "${p.sizesStatus}" requires sizes to be ${hasTable ? "set" : "null"}`,
          );
        if (p.sizesStatus !== "none" && p.columns === null)
          issue("columns", `sizesStatus "${p.sizesStatus}" requires columns`);
        if (p.sizesStatus === "verified" && p.verification === null)
          issue(
            "verification",
            'sizesStatus "verified" requires a verification record',
          );
        if (p.sizesStatus === "verified" && p.expectedRows === undefined)
          issue("expectedRows", 'sizesStatus "verified" requires expectedRows');
        if (p.launchException !== undefined && p.sizesStatus !== "none")
          issue(
            "launchException",
            'launchException is only valid with sizesStatus "none"',
          );
        if (p.drawing !== undefined && p.drawingAlt === undefined)
          issue("drawingAlt", "drawing requires drawingAlt");
        for (const key of p.raw2Columns ?? []) {
          if (
            !(p.columns ?? []).some((c) => c.key === key && c.kind === "pair")
          )
            issue("raw2Columns", `raw2Columns "${key}" is not a pair column`);
        }
      }),
});

// Inline loader: src/content/sizes/<slug>.csv, validated against the columns in
// src/content/products/<slug>.json. Any problem throws, which fails sync/build.
const sizes = defineCollection({
  loader: {
    name: "sizes-csv",
    load: async ({ store, parseData, generateDigest, logger, config }) => {
      const sizesDir = new URL("./src/content/sizes/", config.root);
      const productsDir = new URL("./src/content/products/", config.root);
      const files = (await readdir(sizesDir))
        .filter((f) => f.endsWith(".csv"))
        .sort();
      store.clear();
      for (const f of files) {
        const id = f.slice(0, -".csv".length);
        if (!(PRODUCT_SLUGS as readonly string[]).includes(id)) {
          throw new Error(`sizes/${f}: "${id}" is not a known product slug`);
        }
        const product = JSON.parse(
          await readFile(new URL(`${id}.json`, productsDir), "utf-8"),
        ) as {
          columns: Column[] | null;
          raw2Columns?: string[];
        };
        if (!product.columns) {
          throw new Error(`sizes/${f}: products/${id}.json has columns: null`);
        }
        const text = await readFile(new URL(f, sizesDir), "utf-8");
        const rows = loadSizesCsv(text, product.columns, `sizes/${f}`, {
          raw2Columns: product.raw2Columns ?? [],
        });
        const data = await parseData({
          id,
          data: { rows },
          filePath: fileURLToPath(new URL(f, sizesDir)),
        });
        store.set({
          id,
          data,
          digest: generateDigest(
            text +
              JSON.stringify(product.columns) +
              JSON.stringify(product.raw2Columns ?? []),
          ),
        });
      }
      logger.info(`loaded ${files.length} size table(s)`);
    },
  },
  schema: z.object({
    rows: z.array(sizeRowSchema).min(1),
  }),
});

const categories = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/categories" }),
  schema: z.object({
    name: z.string().min(1),
    order: z.number().int(),
    summary: z.string().min(1),
    attenuationLabel: z.string().min(1).optional(),
    approved: z.boolean(),
    seo: z.object({
      title: z.string().min(1).max(60),
      description: z.string().min(70).max(160),
    }),
  }),
});

const projects = defineCollection({
  loader: file("src/content/projects/projects.json"),
  schema: ({ image }) =>
    z.object({
      id: z.string().min(1),
      // Relative to projects.json, e.g. ../../assets/images/legacy/gallery/37.jpg
      image: image(),
      alt: z.string().min(1),
      caption: z.string().min(1).nullable(), // TODO(client)
      sector: z.string().min(1).nullable(),
      product: reference("products").nullable(),
    }),
});

const legal = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/legal" }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    approved: z.boolean(),
    lastUpdated: z.coerce.date(),
  }),
});

export const collections = { products, sizes, categories, projects, legal };
