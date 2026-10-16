/* Product Schema */

import { z } from "zod";

/**
 * A piece as the dashboard writes it.
 *
 * Shape only. The rules that need the store — the category, colours and sizes
 * exist, a subcategory tag belongs to the category, the slug is free — are the
 * service's. `strict()` throughout, so a field the server does not know about
 * is refused rather than silently dropped: `id`, `createdAt` or `deletedAt`
 * in a body is a 400, never a quiet rewrite of a permanent field.
 */

const text = (max) => z.string().max(max);
const money = z.number().finite().nonnegative().max(1_000_000);
const count = z.number().int().nonnegative().max(1_000_000);
const lines = z.array(text(2000)).max(100);

const colorway = z
  .object({
    colorId: z.string().trim().min(1).max(80),
    images: z.array(text(2000)).max(40).default([]),
    video: z.object({ url: text(2000), poster: text(2000).nullable().optional() }).strict().optional(),
    // Per-size on hand. `null` for a colourway not counted per size yet.
    stock: z.record(z.string().min(1).max(60), count).nullable().optional(),
  })
  .strict();

const fields = {
  name: z.string().trim().min(1, "A product needs a name.").max(200),
  slug: z.string().trim().max(200).optional(),
  sku: z.string().trim().max(80).nullable().optional(),
  description: text(10000).optional(),
  collectionId: z.string().trim().min(1, "Choose a category.").max(80),
  price: money.positive("A product needs a price."),
  costPrice: money.nullable().optional(),
  originalPrice: money.nullable().optional(),
  isNew: z.boolean().optional(),
  featured: z.boolean().optional(),
  bestseller: z.boolean().optional(),
  limited: z.boolean().optional(),
  status: z.enum(["active", "draft"]).optional(),
  colorways: z.array(colorway).max(40).optional(),
  sizes: z.array(z.string().min(1).max(60)).max(60).optional(),
  images: z.array(text(2000)).max(80).optional(),
  // On hand for a piece not counted per colour and size. Ignored (recomputed)
  // for one that is.
  stock: count.optional(),
  lowStockThreshold: count.nullable().optional(),
  // Only `subcat:<sub>:<type>` filing tags; the rest are derived on read.
  tags: z.array(z.string().max(200)).max(100).optional(),
  modelFit: z.object({ modelId: text(80), size: text(60) }).strict().nullable().optional(),
  details: lines.optional(),
  materials: lines.optional(),
  care: lines.optional(),
  isNonReturnable: z.boolean().optional(),
  hairType: text(80).optional(),
  lengthInInches: z.number().finite().nonnegative().max(200).optional(),
  weight: z.number().finite().nonnegative().max(100000).optional(),
};

/** `POST /products`. */
export const createProductSchema = z.object(fields).strict();

/** `PATCH /products/:id`: any subset, same rules. */
export const updateProductSchema = z.object(fields).partial().strict();
