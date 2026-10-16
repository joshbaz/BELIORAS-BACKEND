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

/**
 * `POST /inventory/order-movements`: what shipping or a return does to stock.
 * Always tied to an order, and only ever "sold" (units leave) or "returned"
 * (units come back), so this edge cannot be used as a general stock editor by
 * roles that may handle orders but not inventory.
 */
export const orderMovementsSchema = z
  .object({
    orderId: z.string().trim().min(1).max(80),
    reason: z.enum(["sold", "returned"]),
    lines: z
      .array(z.object({ ...variant, quantity: z.number().int().positive().max(10000) }).strict())
      .min(1)
      .max(200),
  })
  .strict();

/** `PUT /inventory/settings`. */
export const inventorySettingsSchema = z
  .object({ lowStockThreshold: z.number().int().min(0, "Enter a whole number from 0 to 999.").max(999, "Enter a whole number from 0 to 999.") })
  .strict();
