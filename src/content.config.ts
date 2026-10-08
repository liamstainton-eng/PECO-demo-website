import { defineCollection, reference } from "astro:content";
import { file, glob } from "astro/loaders";
import { z } from "astro/zod";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadSizesCsv } from "./lib/csv.ts";
import type { Column, SizeRow } from "./lib/csv.ts";
import { PRODUCT_SLUGS } from "./content/slugs.ts";

const columnSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),
  label: z.string().min(1),
  kind: z.enum(["pair", "holes", "bolt"]),
});

const products = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/products" }),
  schema: ({ image }) =>
    z.object({
      model: z.string(),
      name: z.string(),
      category: reference("categories"),
      // As printed on the datasheet, e.g. "SEA EXHAUST GAS SILENCER"; null when there is no datasheet.
      datasheetTitle: z.string().nullable(),
      attenuationDbA: z.number().nullable(),
      attenuationSource: z.enum(["datasheet", "page-copy", "todo"]),
      type: z.string().nullable(),
      summary: z.string(),
      description: z.array(z.string()),
      options: z.array(z.string()), // verbatim from that model's datasheet
      // Relative to the JSON file, e.g. ../../assets/images/legacy/PECO-SEA-.png
      drawing: image().optional(),
      drawingAlt: z.string().optional(),
      columns: z.array(columnSchema).nullable(),
      figures: z.record(z.string(), z.string()).optional(), // {"1": "1–3 in screwed", "2": "3½–8 in flanged"}
      tableNotes: z.array(z.string()).default([]),
      sizes: reference("sizes").nullable(), // null when no CSV exists yet
      sizesStatus: z.enum([
        "verified",
        "fixture",
        "pending-transcription",
        "none",
      ]),
      verification: z
        .object({
          method: z.enum(["source-file", "double-blind"]),
          disputes: z.number(),
          humanSpotCheck: z.boolean(),
          clientApproved: z.boolean(),
        })
        .nullable()
        .default(null),
      related: z.array(reference("products")).default([]),
      seo: z.object({
        title: z.string().max(60),
        description: z.string().min(70).max(160),
      }),
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
        };
        if (!product.columns) {
          throw new Error(`sizes/${f}: products/${id}.json has columns: null`);
        }
        const text = await readFile(new URL(f, sizesDir), "utf-8");
        const rows = loadSizesCsv(text, product.columns, `sizes/${f}`);
        const data = await parseData({
          id,
          data: { rows },
          filePath: fileURLToPath(new URL(f, sizesDir)),
        });
        store.set({
          id,
          data,
          digest: generateDigest(text + JSON.stringify(product.columns)),
        });
      }
      logger.info(`loaded ${files.length} size table(s)`);
    },
  },
  schema: z.object({
    rows: z.array(z.custom<SizeRow>()).min(1),
  }),
});

const categories = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/categories" }),
  schema: z.object({
    name: z.string(),
    order: z.number().int(),
    summary: z.string(),
    attenuationLabel: z.string().optional(),
    approved: z.boolean(),
    seo: z.object({
      title: z.string().max(60),
      description: z.string().min(70).max(160),
    }),
  }),
});

const projects = defineCollection({
  loader: file("src/content/projects/projects.json"),
  schema: ({ image }) =>
    z.object({
      id: z.string(),
      // Relative to projects.json, e.g. ../../assets/images/legacy/gallery/37.jpg
      image: image(),
      alt: z.string().min(1),
      caption: z.string().nullable(), // TODO(client)
      sector: z.string().nullable(),
      product: reference("products").nullable(),
    }),
});

const legal = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/legal" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    approved: z.boolean(),
    lastUpdated: z.coerce.date(),
  }),
});

export const collections = { products, sizes, categories, projects, legal };
