/* Colour Seed */

import { readFileSync } from "node:fs";

/**
 * The shipped colour list. `seed.json` is a copy of the client's
 * `src/data/colors.json` — the floor the storefront falls back to offline —
 * and the ids are pinned because products already store their colourways by
 * them. Keep the two files the same; reset and `yarn seed:colors` read this one.
 */
const raw = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));

export const SEED_COLORS = raw.map(({ id, name, hex, family }) => ({ id, name, hex: hex.toUpperCase(), family }));
