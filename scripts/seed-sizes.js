/* Seed Size List — the shipped twelve */

import "dotenv/config";

/**
 * Writes the size list into the database so a fresh environment offers the same
 * sizes the shop has always offered.
 *
 * Idempotent, and *deliberately* not overwriting by default, for the same reason
 * `seed-size-guides` does not: re-running a seed is the obvious response to "the
 * sizes are wrong", and silently undoing a real person's edits in the process is
 * a bad way to find that out. Pass `--force` when replacing them is the intent.
 *
 * The ids are pinned to the twelve the shop already uses rather than derived from
 * the names, because they are not ours to choose — they are keys in stock
 * objects and segments of bookmarked URLs. See `src/features/sizes/seed.js` for
 * the full account of what depends on them.
 *
 * The content lives in `src/features/sizes/seed.js` — the same file the
 * dashboard's reset reads from, so there is one copy rather than two that can
 * disagree.
 *
 *   yarn seed:sizes
 *   yarn seed:sizes --force
 */

import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/db/redis.js";
import { SEED_SIZES } from "../src/features/sizes/seed.js";
import { createSizeSchema, sizeIdSchema } from "../src/versions/v1/schemas/sizes.schema.js";

// Validate before writing anything. If the seed file has drifted from the
// schema, this fails on a field name rather than storing an id that can never be
// used — an id is a contract, so a typo in one is not a cosmetic problem.
for (const row of SEED_SIZES) {
  const result = createSizeSchema.safeParse(row);
  const idResult = sizeIdSchema.safeParse(row.id);
  if (!result.success || !idResult.success) {
    const issues = [...(result.error?.issues ?? []), ...(idResult.error?.issues ?? [])];
    console.error(`Refusing to seed: shipped size ${JSON.stringify(row)} does not match its schema.`);
    for (const issue of issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Two seeds must not claim the same id, or the unique index would fail on the
// second and leave the list half-written. Cheap to check next to the write.
const ids = SEED_SIZES.map((s) => s.id);
if (new Set(ids).size !== ids.length) {
  console.error("Refusing to seed: the shipped list contains a duplicate id.");
  await prisma.$disconnect();
  process.exit(1);
}
const names = SEED_SIZES.map((s) => s.name.trim().toLowerCase());
if (new Set(names).size !== names.length) {
  console.error("Refusing to seed: the shipped list contains a duplicate name.");
  await prisma.$disconnect();
  process.exit(1);
}

const force = process.argv.includes("--force");
const existing = await prisma.size.findMany({ select: { id: true } });
const alreadyThere = new Set(existing.map((row) => row.id));

if (alreadyThere.size && !force) {
  console.log(`Nothing to do: ${alreadyThere.size} size(s) already seeded.`);
  console.log("Pass --force to replace the stored names and order with the shipped ones.");
  console.log("Ids are never changed by this script — they are pinned, and a rename is the dashboard's job.");
} else {
  for (const row of SEED_SIZES) {
    await prisma.size.upsert({ where: { id: row.id }, create: row, update: { name: row.name, position: row.position } });
    console.log(`${alreadyThere.has(row.id) ? "Restored" : "Seeded"} ${row.id} — ${row.name}`);
  }
  console.log(`\n${SEED_SIZES.length} sizes in place.`);
}

await prisma.$disconnect();
// The session cache opened a Redis connection, which would otherwise hold the
// event loop open and leave this script hanging after it has done its work.
await redis.quit().catch(() => {});
