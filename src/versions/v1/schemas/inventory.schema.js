/* Inventory Schema */

import { z } from "zod";

export const REASONS = ["received", "adjusted", "counted", "damaged", "sold", "returned"];

const variant = {
  productId: z.string().trim().min(1).max(80),
  colorId: z.string().trim().min(1).max(80).default("*"),
  size: z.string().trim().min(1).max(60).default("*"),
};
const note = z.string().trim().max(500).nullable().optional();

/** `POST /inventory/adjust`: one variant, by mode. Sold and returned belong to orders, not to a hand adjustment. */
export const adjustStockSchema = z
  .object({
    ...variant,
    mode: z.enum(["add", "remove", "set"]),
    quantity: z.number().int().nonnegative().max(100000),
    reason: z.enum(["received", "adjusted", "counted", "damaged"]).default("adjusted"),
    note,
  })
  .strict();

/** `POST /inventory/receive`: the same number added to each variant. */
export const receiveStockSchema = z
  .object({
    variants: z.array(z.object(variant).strict()).min(1).max(500),
    quantity: z.number().int().positive("Enter how many pieces arrived.").max(100000),
    reason: z.enum(["received", "adjusted", "counted"]).default("received"),
    note,
  })
  .strict();

/** `PUT /inventory/settings`. */
export const inventorySettingsSchema = z
  .object({ lowStockThreshold: z.number().int().min(0, "Enter a whole number from 0 to 999.").max(999, "Enter a whole number from 0 to 999.") })
  .strict();
