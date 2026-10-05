/* Seed Categories — the shipped three */

import "dotenv/config";

/**
 * Writes the shipped categories into the database so a fresh environment has
 * the same Dresses, Hair and Accessories the storefront was built around.
 *
 * Idempotent and not overwriting by default, like `seed-sizes`: re-running a
 * seed should not quietly undo a real person's edits. Pass `--force` to put the
 * shipped names, types, subcategories and order back.
 *
 *   yarn seed:categories
 *   yarn seed:categories --force
 */

import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/db/redis.js";
import { SEED_CATEGORIES } from "../src/features/categories/seed.js";
import { createCategorySchema } from "../src/versions/v1/schemas/categories.schema.js";

async function refuse(message) {
  console.error(`Refusing to seed: ${message}`);
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
  process.exit(1);
}

for (const { id, position, ...body } of SEED_CATEGORIES) {
  const result = createCategorySchema.safeParse(body);
  if (!result.success) {
    console.error(`Shipped category "${id}" does not match its schema.`);
    for (const issue of result.error.issues) console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    await refuse("fix seed.json first.");
  }
}

const ids = SEED_CATEGORIES.map((c) => c.id);
if (new Set(ids).size !== ids.length) await refuse("the shipped list contains a duplicate id.");

const force = process.argv.includes("--force");
const existing = await prisma.category.findMany({ select: { id: true } });
const alreadyThere = new Set(existing.map((row) => row.id));

if (alreadyThere.size && !force) {
  console.log(`Nothing to do: ${alreadyThere.size} categor${alreadyThere.size === 1 ? "y" : "ies"} already seeded.`);
  console.log("Pass --force to replace the stored ones with the shipped versions.");
} else {
  for (const row of SEED_CATEGORIES) {
    const { id, ...data } = row;
    await prisma.category.upsert({ where: { id }, create: row, update: data });
    console.log(`${alreadyThere.has(id) ? "Restored" : "Seeded"} ${id} — ${row.name}`);
  }
  console.log(`\n${SEED_CATEGORIES.length} categories in place.`);
}

await prisma.$disconnect();
await redis.quit().catch(() => {});
