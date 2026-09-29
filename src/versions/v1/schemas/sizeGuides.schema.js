/* Size Guides Schema */

import { z } from "zod";

/**
 * The three size guides, and what each one measures.
 *
 * The three are genuinely different documents, so they get three schemas rather
 * than one schema with optional fields — a hair length is not a shoe conversion
 * with the keys left off, and a payload missing a column it is supposed to carry
 * should be rejected here rather than render a blank cell for a shopper.
 *
 * `type` is a string plus a predicate rather than `z.enum`, following the house
 * style in `auth.schema.js`: Zod 4 reports a bad enum member as "Invalid option:
 * expected one of …", which tells the caller what went wrong and not what to
 * send instead.
 */

export const GUIDE_TYPES = ["garment", "footwear", "hair"];

/** A `[smallest, largest]` body measurement. Reversed is refused: it sorts fine and reads as nonsense. */
const range = (label) =>
  z
    .tuple([z.number(), z.number()])
    .refine(([from, to]) => from <= to, {
      message: `${label}: the smallest cannot be above the largest.`,
      path: [0],
    });

const sizeLabel = z.string().trim().min(1, "Every size needs a name.").max(16, "That size name is too long.");

/** "How to measure" steps: a term and a sentence. */
const howToStep = z.object({
  term: z.string().trim().min(1, "Every step needs a title.").max(80),
  text: z.string().trim().min(1, "Every step needs an instruction.").max(600),
});

const howTo = z.array(howToStep).max(24);

/** Body measurements, and the same size in five other markets. */
const garment = z.object({
  note: z.string().trim().max(1200).default(""),
  rows: z
    .array(
      z.object({
        size: sizeLabel,
        bust: range("Bust"),
        waist: range("Waist"),
        hip: range("Hip"),
      }),
    )
    .max(60),
  international: z.object({
    // The headings the storefront prints, in the order it prints them.
    columns: z.array(z.string().trim().min(1)).min(1).max(12),
    rows: z
      .array(
        z.object({
          size: sizeLabel,
          // Ranges as typed ("32–34"), so text rather than a pair of numbers.
          us: z.string().trim().max(40).default(""),
          uk: z.string().trim().max(40).default(""),
          eu: z.string().trim().max(40).default(""),
          aus: z.string().trim().max(40).default(""),
          tr: z.string().trim().max(40).default(""),
        }),
      )
      .max(60),
  }),
  howTo,
  garmentImage: z.string().trim().url("That does not look like a web address.").max(500).or(z.literal("")).default(""),
});

/** EU/UK/US against the foot length it fits. */
const footwear = z.object({
  note: z.string().trim().max(1200).default(""),
  rows: z
    .array(
      z.object({
        eu: z.number("EU must be a number."),
        uk: z.number("UK must be a number."),
        us: z.number("US must be a number."),
        cm: z.number("Foot length must be a number."),
      }),
    )
    .max(60),
  howTo,
});

/** Lengths, and how each curl pattern wears against the stated length. */
const hair = z.object({
  note: z.string().trim().max(1200).default(""),
  lengths: z
    .array(
      z.object({
        in: z.number("Length must be a number."),
        falls: z.string().trim().max(120).default(""),
        note: z.string().trim().max(400).default(""),
      }),
    )
    .max(60),
  textures: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Every texture needs a name.").max(60),
        note: z.string().trim().max(400).default(""),
      }),
    )
    .max(40),
  howTo,
});

/** `:type` on the route, checked before the body so a bad path is a 404, not a validation error. */
export const guideTypeSchema = z
  .string()
  .refine((value) => GUIDE_TYPES.includes(value), { message: "Unknown size guide." });

/**
 * The body of a `PUT /size-guides/:type`, by guide type.
 *
 * Keyed rather than one schema with optional fields, so the route can pick the
 * schema that matches the `:type` it was actually asked for. Sending a hair
 * guide to `/size-guides/garment` is then a validation failure rather than a
 * well-formed document stored under the wrong name.
 */
export const GUIDE_BODY_SCHEMAS = { garment, footwear, hair };
