/* Colour Schema */

import { z } from "zod";

/**
 * A colour as the dashboard writes it. Shape only: unique names, permanent
 * ids and spent ids need the store, so they live in the service.
 */

const fields = {
  name: z.string().trim().min(1, "Give the colour a name.").max(60, "That colour name is too long."),
  hex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Choose a swatch, as a hex code like #120700.")
    .transform((v) => v.toUpperCase()),
  // A taxonomy colour id (black, brown…). The taxonomy is still client-side,
  // so only the shape is checked here.
  family: z
    .string()
    .trim()
    .min(1, "Choose which shop filter the colour belongs to.")
    .max(40)
    .regex(/^[a-z0-9-]+$/, "That filter family is not a valid id."),
};

/** `POST /taxonomy/colors`. The id is derived by the service, never supplied. */
export const createColorSchema = z.object(fields).strict();

/**
 * `PATCH /taxonomy/colors/:id`. `strict()`: an `id` in the body is a 400, not a
 * silently dropped key — re-pointing a colour id would re-point every
 * colourway holding it.
 */
export const updateColorSchema = z.object(fields).strict();
