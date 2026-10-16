/* Order Schemas */

import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(200);

/**
 * `POST /checkout`. Only what the shopper chose: the server prices every line
 * from the catalogue, so a price in this body would be ignored — it is not
 * accepted at all. `expectedTotal` is the total the shopper was shown; if the
 * server's differs, the order is refused rather than charged.
 */
export const checkoutSchema = z
  .object({
    email,
    name: z.string().trim().min(1, "Enter your name.").max(200),
    phone: z.string().trim().max(40).nullable().optional(),
    items: z
      .array(
        z
          .object({
            productId: z.string().trim().min(1).max(80),
            quantity: z.number().int().positive().max(20),
            size: z.string().trim().max(60).nullable().optional(),
            color: z.string().trim().max(80).nullable().optional(),
          })
          .strict(),
      )
      .min(1, "Your bag is empty.")
      .max(50),
    couponCode: z.string().trim().max(60).nullable().optional(),
    country: z.string().trim().min(1, "Choose the delivery country.").max(80),
    shippingAddress: z.string().trim().min(1, "Enter the delivery address.").max(500),
    expectedTotal: z.number().nonnegative().optional(),
  })
  .strict();

export const simulatePaymentSchema = z
  .object({ method: z.enum(["card", "paypal"]).default("card"), email: email.optional() })
  .strict();

export const cancelSchema = z.object({ reason: z.string().trim().max(500).nullable().optional(), email: email.optional() }).strict();

export const statusSchema = z
  .object({
    status: z.string().trim().min(1),
    trackingRef: z.string().trim().max(120).nullable().optional(),
    carrier: z.string().trim().max(80).nullable().optional(),
  })
  .strict();

export const refundSchema = z
  .object({
    lines: z.array(z.object({ index: z.number().int().nonnegative(), quantity: z.number().int().nonnegative() }).strict()).max(100).default([]),
    includeShipping: z.boolean().default(false),
    amount: z.number().nonnegative().nullable().optional(),
    reason: z.string().trim().max(500).default(""),
    restock: z.boolean().default(false),
  })
  .strict();

export const couponSchema = z
  .object({
    code: z.string().trim().min(1, "Give the coupon a code.").max(40),
    type: z.enum(["percent", "fixed", "free_shipping"], { message: "Choose what the coupon gives." }),
    value: z.number().nonnegative().default(0),
    minOrderValue: z.number().nonnegative().default(0),
    maxDiscount: z.number().positive().nullable().optional(),
    maxUses: z.number().int().positive("Total uses must be a whole number, 1 or more — or blank for no limit.").nullable().optional(),
    maxUsesPerCustomer: z.number().int().positive("Uses per customer must be a whole number, 1 or more — or blank for no limit.").nullable().optional(),
    expiresAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
    active: z.boolean().optional(),
    description: z.string().max(500).optional(),
  })
  .strict();

export const couponPatchSchema = couponSchema.partial().strict();

export const validateCouponSchema = z
  .object({ code: z.string().trim().min(1).max(60), subtotal: z.number().nonnegative().default(0), email: email.optional() })
  .strict();

/** `PATCH /settings`: whole sections, merged key by key. */
export const settingsPatchSchema = z.record(z.string().max(60), z.unknown());
