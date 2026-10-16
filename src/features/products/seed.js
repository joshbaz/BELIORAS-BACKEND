/* Product Seed */

import { readFileSync } from "node:fs";

/**
 * The shipped catalogue: copies of the client's `products.json`, `hair.json`,
 * `accessories.json` and `catalogExtra.json` (joined in that order, as
 * `catalogSeed.js` joins them). The ids are pinned — order history and the
 * stock ledger already point at them.
 */
const read = (file) => JSON.parse(readFileSync(new URL(`./seed/${file}`, import.meta.url), "utf8"));

export const SEED_PRODUCTS = ["products.json", "hair.json", "accessories.json", "catalogExtra.json"].flatMap(read);
