/* Navigation Seed */

import { readFileSync } from "node:fs";

/**
 * The shipped menu tree. `seed.json` is a copy of the `items` in the client's
 * `src/data/navigation.json` — the floor the storefront falls back to offline.
 * Keep the two the same; reset and `yarn seed:navigation` read this one.
 */
export const SEED_NAVIGATION = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));
