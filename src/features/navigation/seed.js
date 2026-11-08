/* Navigation Seed */

import navigationSeed from "./seed.json" with { type: "json" };

/**
 * The shipped menu tree. `seed.json` is a copy of the `items` in the client's
 * `src/data/navigation.json` — the floor the storefront falls back to offline.
 * Keep the two the same; reset and `yarn seed:navigation` read this one.
 */
export const SEED_NAVIGATION = navigationSeed;
