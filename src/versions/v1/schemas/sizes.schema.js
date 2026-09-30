/* Size List Schema */

import { z } from "zod";

/**
 * The size list — "M", "EU 38 · UK 3 · US 5", "One Size" — that a category
 * offers from and a product picks within.
 *
 * Deliberately thin. The interesting rules in this resource are not about the
 * shape of a name; they are about the id never changing, and that is enforced in
 * the service (which can see the store) rather than here (which cannot).
 */

/** Display name. Free text, and the only thing a rename may change. */
const sizeName = z.string().trim().min(1, "Every size needs a name.").max(60, "That size name is too long.");

/** An id, as it appears in a path. Bounded because it is a URL segment and a stock key. */
export const sizeIdSchema = z
  .string()
  .trim()
  .min(1, "A size needs an id.")
  .max(60, "That size id is too long.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "A size id can only use letters, numbers, dots, dashes and underscores.");

/**
 * The body of a `POST /taxonomy/sizes`.
 *
 * `id` is optional, and when given it must be free. The service is what
 * actually enforces "must be free" — it has to, because only it can see that the
 * id was deleted last month and a product still holds it — so a duplicate id
 * arrives here as a well-formed body and is turned away one layer down as a 409.
 */
export const createSizeSchema = z.object({
  name: sizeName,
  id: sizeIdSchema.optional(),
});

/**
 * The body of a `PATCH /taxonomy/sizes/:id`.
 *
 * `strict()` is the point of this schema, and it is why the route can trust
 * that a rename changed nothing else. Without it, Zod would quietly drop an
 * `id` or a `position` from the body and the request would return 200 having
 * changed only the name — which is a lie the caller cannot detect. Rejecting
 * the extra key instead means a client that tries to re-point a size's id (and
 * with it every stock row and every `?size=` URL carrying it) is told so.
 */
export const renameSizeSchema = z
  .object({ name: sizeName })
  .strict();
