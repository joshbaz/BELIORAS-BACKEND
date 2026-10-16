/* Seed Products — the shipped catalogue */

import "dotenv/config";

/**
 * Writes the shipped catalogue into the database. Adds only the pieces that
 * are missing, so re-running it never undoes a real edit; `--force` puts every
 * shipped piece back as it shipped (pieces added in the dashboard are left
 * alone either way).
 *
 * Seed categories, colours and sizes first — products are filed under them.
 *
 *   yarn seed:products
 *   yarn seed:products --force
 */

import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/db/redis.js";
import { SEED_PRODUCTS } from "../src/features/products/seed.js";
import { seedRecord } from "../src/features/products/products.service.js";

const ids = SEED_PRODUCTS.map((p) => p.id);
const slugs = SEED_PRODUCTS.map((p) => p.slug);
if (new Set(ids).size !== ids.length || new Set(slugs).size !== slugs.length) {
  console.error("Refusing to seed: the shipped catalogue repeats an id or a slug.");
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
  process.exit(1);
}

const force = process.argv.includes("--force");
const existing = new Set((await prisma.product.findMany({ select: { id: true } })).map((p) => p.id));
let written = 0;

for (const flat of SEED_PRODUCTS) {
  if (existing.has(flat.id) && !force) continue;
  const { id, ...data } = seedRecord(flat);
  await prisma.product.upsert({ where: { id }, create: { id, ...data }, update: { ...data, deletedAt: null } });
  written += 1;
}

console.log(`${written} product(s) written; ${SEED_PRODUCTS.length - written} already there.`);
if (!force && written < SEED_PRODUCTS.length) console.log("Pass --force to put the shipped versions back.");

await prisma.$disconnect();
await redis.quit().catch(() => {});
