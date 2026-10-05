/* Category Seed */

import { readFileSync } from "node:fs";

/**
 * The three categories the shop shipped with — Dresses, Hair, Accessories —
 * with their types and subcategories, in display order.
 *
 * `seed.json` is a copy of the client's `src/data/categories.json`, which is the
 * floor the storefront falls back to when it can reach neither this server nor
 * its own cache. The ids are pinned rather than derived for the same reason a
 * size's are: they are already every product's `collectionId`, the `/dresses`
 * URL and a filter token, so they are not ours to choose. Keep the two files
 * the same; the dashboard's reset and `yarn seed:categories` both read this one.
 */
const raw = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));

export const SEED_CATEGORIES = raw.map((c, position) => ({
  id: c.id,
  name: c.name,
  position,
  sizes: c.sizes ?? [],
  types: (c.types ?? []).map(({ id, name }) => ({ id, name })),
  subcategories: (c.subcategories ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    types: (s.types ?? []).map(({ id, name }) => ({ id, name })),
  })),
}));
