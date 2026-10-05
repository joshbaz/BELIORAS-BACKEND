/* Seed Navigation — the shipped mega menu */

import "dotenv/config";

/**
 * Writes the shipped menu into the database. Not needed for a fresh database —
 * the first read creates it from the seed — but `--force` is the way to put the
 * shipped menu back from the command line. Without it, an existing menu is left
 * alone, so re-running a seed never undoes a real person's edits.
 *
 *   yarn seed:navigation
 *   yarn seed:navigation --force
 */

import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/db/redis.js";
import { SEED_NAVIGATION } from "../src/features/navigation/seed.js";
import { updateNavigationSchema } from "../src/versions/v1/schemas/navigation.schema.js";

const check = updateNavigationSchema.safeParse({ items: SEED_NAVIGATION, version: 1 });
if (!check.success) {
  for (const issue of check.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  console.error("Refusing to seed: the shipped menu does not match its schema.");
  await prisma.$disconnect();
  await redis.quit().catch(() => {});
  process.exit(1);
}

const force = process.argv.includes("--force");
const existing = await prisma.navigation.findUnique({ where: { id: "main" } });

if (existing && !force) {
  console.log(`Nothing to do: the menu is already stored (version ${existing.version}).`);
  console.log("Pass --force to replace it with the shipped menu.");
} else {
  const record = await prisma.navigation.upsert({
    where: { id: "main" },
    create: { id: "main", items: SEED_NAVIGATION },
    update: { items: SEED_NAVIGATION, version: { increment: 1 } },
  });
  console.log(`Menu in place: ${SEED_NAVIGATION.length} items, version ${record.version}.`);
}

await prisma.$disconnect();
await redis.quit().catch(() => {});
