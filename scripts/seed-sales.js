/* Seed Sales — shipped orders, transactions, coupons and store settings */

import "dotenv/config";

/**
 * Writes the shipped demo orders, their transactions, the coupons and the store
 * settings. Adds only what is missing, so re-running never undoes real orders
 * or edits; `--force` puts the shipped versions back (orders placed since are
 * left alone either way). Seed products first — orders point at them.
 *
 *   yarn seed:sales
 *   yarn seed:sales --force
 */

import { prisma } from "../src/db/prisma.js";
import { redis } from "../src/db/redis.js";
import { SEED_COUPONS, seedCoupon } from "../src/features/coupons/coupons.service.js";
import { SEED_ORDERS, seedOrder } from "../src/features/orders/orders.service.js";
import { SEED_TRANSACTIONS } from "../src/features/payments/payments.service.js";
import { getStoreSettings } from "../src/features/settings/settings.service.js";
import { SEED_REVIEWS, seedReview } from "../src/features/reviews/reviews.service.js";
import { SEED_CAMPAIGNS, SEED_SUBSCRIBERS, getNewsletterSettings, seedCampaign, seedSubscriber } from "../src/features/marketing/marketing.service.js";

const force = process.argv.includes("--force");

async function upsertAll(model, rows, toRow) {
  const existing = new Set((await prisma[model].findMany({ select: { id: true } })).map((r) => r.id));
  let written = 0;
  for (const row of rows) {
    if (existing.has(row.id) && !force) continue;
    const { id, ...data } = toRow(row);
    await prisma[model].upsert({ where: { id }, create: { id, ...data }, update: data });
    written += 1;
  }
  console.log(`${model}: ${written} written, ${rows.length - written} already there.`);
}

await getStoreSettings();
console.log("settings: in place.");
await upsertAll("coupon", SEED_COUPONS, seedCoupon);
await upsertAll("order", SEED_ORDERS, seedOrder);
await upsertAll("review", SEED_REVIEWS, seedReview);
await getNewsletterSettings();
await upsertAll("subscriber", SEED_SUBSCRIBERS, seedSubscriber);
await upsertAll("campaign", SEED_CAMPAIGNS, seedCampaign);
await upsertAll("transaction", SEED_TRANSACTIONS, (t) => ({
  ...t,
  method: t.method ?? undefined,
  createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
  simulated: Boolean(t.simulated),
}));

await prisma.$disconnect();
await redis.quit().catch(() => {});
