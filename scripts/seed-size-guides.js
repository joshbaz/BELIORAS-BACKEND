/* Seed Size Guides — the shipped guides */

import "dotenv/config";

/**
 * Writes the three size guides into the database so a fresh environment shows
 * the same measurements the site has always shown.
 *
 * Idempotent, and *deliberately* not overwriting by default. A re-run is the
 * obvious response to "the guides are wrong", and silently undoing a real
 * person's edits to every table in the process is a bad way to find that out.
 * Pass `--force` when replacing them is the actual intent.
 *
 * The content lives in `src/features/sizeGuides/seed.js` — the same file the
 * dashboard's "Reset to defaults" reads from, so there is one copy of the
 * shipped guides rather than two that can disagree.
 *
 *   yarn seed:size-guides
 *   yarn seed:size-guides --force
 */

import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/db/redis.js";
import { SEED_SIZE_GUIDES } from "../src/features/sizeGuides/seed.js";
import { GUIDE_BODY_SCHEMAS, GUIDE_TYPES } from "../src/versions/v1/schemas/sizeGuides.schema.js";

const force = process.argv.includes("--force");

// Validate before writing anything. If the seed file has drifted from the
// schemas, this fails with a field name rather than storing a guide the
// storefront would then render with a blank cell.
for (const type of GUIDE_TYPES) {
  const result = GUIDE_BODY_SCHEMAS[type].safeParse(SEED_SIZE_GUIDES[type]);
  if (!result.success) {
    console.error(`Refusing to seed: the shipped ${type} guide does not match its schema.`);
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }
}

const existing = await prisma.sizeGuide.findMany({ select: { type: true } });
const alreadyThere = new Set(existing.map((row) => row.type));

if (alreadyThere.size && !force) {
  console.log(`Nothing to do: ${[...alreadyThere].join(", ")} already seeded.`);
  console.log("Pass --force to replace the stored guides with the shipped versions.");
} else {
  for (const type of GUIDE_TYPES) {
    const guide = SEED_SIZE_GUIDES[type];
    await prisma.sizeGuide.upsert({
      where: { type },
      create: { type, data: guide },
      update: { data: guide },
    });
    const verb = alreadyThere.has(type) ? "Replaced" : "Seeded";
    console.log(`${verb} ${type} guide.`);
  }
}

await prisma.$disconnect();
// The session cache opened a Redis connection, which would otherwise hold the
// event loop open and leave this script hanging after it has done its work.
await redis.quit().catch(() => {});
