/* Product Seed */

import products from "./seed/products.json" with { type: "json" };
import hair from "./seed/hair.json" with { type: "json" };
import accessories from "./seed/accessories.json" with { type: "json" };
import catalogExtra from "./seed/catalogExtra.json" with { type: "json" };

/**
 * The shipped catalogue: copies of the client's `products.json`, `hair.json`,
 * `accessories.json` and `catalogExtra.json` (joined in that order, as
 * `catalogSeed.js` joins them). The ids are pinned — order history and the
 * stock ledger already point at them.
 */
export const SEED_PRODUCTS = [...products, ...hair, ...accessories, ...catalogExtra];
