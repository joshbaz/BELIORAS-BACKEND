/* Seed Colours — the shipped list */

import "dotenv/config";

/**
 * Writes the shipped colour list into the database. Idempotent and not
 * overwriting by default, like `seed-categories`; `--force` puts the shipped
 * names, swatches and families back.
 *
 *   yarn seed:colors
 *   yarn seed:colors --force
 */

import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/db/redis.js";
import { SEED_COLORS } from "../src/features/colors/seed.js";
import { createColorSchema } from "../src/versions/v1/schemas/colors.schema.js";

async function refuse(message) {
  console.error(`Refusing to seed: ${message}`);
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
  process.exit(1);
}

for (const { id, ...body } of SEED_COLORS) {
  const result = createColorSchema.safeParse(body);
  if (!result.success) {
    for (const issue of result.error.issues) console.error(`  ${id}.${issue.path.join(".")}: ${issue.message}`);
    await refuse(`shipped colour "${id}" does not match its schema.`);
  }
}
const ids = SEED_COLORS.map((c) => c.id);
if (new Set(ids).size !== ids.length) await refuse("the shipped list contains a duplicate id.");

const force = process.argv.includes("--force");
const existing = await prisma.color.findMany({ select: { id: true } });
const alreadyThere = new Set(existing.map((row) => row.id));

if (alreadyThere.size && !force) {
  console.log(`Nothing to do: ${alreadyThere.size} colour(s) already seeded.`);
  console.log("Pass --force to replace the stored ones with the shipped versions.");
} else {
  for (const row of SEED_COLORS) {
    const { id, ...data } = row;
    await prisma.color.upsert({ where: { id }, create: row, update: data });
    console.log(`${alreadyThere.has(id) ? "Restored" : "Seeded"} ${id} — ${row.name}`);
  }
  console.log(`\n${SEED_COLORS.length} colours in place.`);
}

await prisma.$disconnect();
await redis.quit().catch(() => {});
