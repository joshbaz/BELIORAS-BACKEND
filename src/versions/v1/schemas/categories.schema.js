/* Category Schema */

import { z } from "zod";
import { sizeIdSchema } from "./sizes.schema.js";

/**
 * A category as the dashboard writes it: a name, the sizes it offers, and its
 * "Shop by …" subcategories with the types under each. Types live only inside
 * subcategories; a category has no flat type list of its own (a body carrying
 * `types` is a 400, since the schema is strict).
 *
 * Shape only. The rules that matter — ids never change, a spent id is never
 * reissued, a name is unique — need to see the store, so they live in the
 * service. Type and subcategory ids are optional here because the service
 * assigns them: an id it recognises is kept, anything else is derived from the
 * name.
 */

const name = (noun) =>
  z.string().trim().min(1, `Every ${noun} needs a name.`).max(80, `That ${noun} name is too long.`);

/** A child id as the client echoes it back. Unknown ids are not an error — they are re-derived. */
const childId = z.string().trim().max(80).optional();

const typeSchema = z.object({ id: childId, name: name("type") });

const subcategorySchema = z.object({
  id: childId,
  name: name("subcategory"),
  types: z.array(typeSchema).max(100).default([]),
});

const fields = {
  name: name("category"),
  sizes: z.array(sizeIdSchema).max(100).default([]),
  subcategories: z.array(subcategorySchema).max(30).default([]),
};

/** `POST /taxonomy/categories`. The id is derived by the service, never supplied. */
export const createCategorySchema = z.object(fields).strict();

/**
 * `PATCH /taxonomy/categories/:id`.
 *
 * `strict()` for the same reason as a size rename: a body carrying an `id` or
 * a `position` is refused rather than having those keys silently dropped,
 * because re-pointing a category id is re-pointing every product filed under
 * it and every `/dresses` link. Order changes go through `PUT /order`.
 */
export const updateCategorySchema = z.object(fields).strict();

/** `PUT /taxonomy/categories/order`: every category id, in the new order. */
export const reorderCategoriesSchema = z
  .object({ ids: z.array(z.string().trim().min(1)).min(1).max(500) })
  .strict();
