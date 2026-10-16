/* Store Settings Service */

import { readFileSync } from "node:fs";
import { prisma } from "../../db/prisma.js";
import { audit } from "../audit/audit.js";

/**
 * The shop's settings document: shipping zones, VAT, the invoice prefix and
 * seller details, contact and storefront copy. The server needs it to price an
 * order and print an invoice, so it is the server's copy that counts.
 *
 * Saved section by section (a patch's `shipping` replaces only the shipping
 * section's named keys), so two people editing different panels do not
 * overwrite each other. Created from the shipped settings on first read.
 */

const ID = "store";
const { rev: _rev, ...SEED } = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));

export async function getStoreSettings(db = prisma) {
  const row = await db.setting.findUnique({ where: { id: ID } });
  if (row) return row.value;
  await prisma.setting.upsert({ where: { id: ID }, create: { id: ID, value: SEED }, update: {} });
  return SEED;
}

export async function updateStoreSettings(patch, actor, meta = {}) {
  const current = await getStoreSettings();
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value && typeof value === "object" && !Array.isArray(value) ? { ...(current[key] ?? {}), ...value } : value;
  }
  await prisma.setting.update({ where: { id: ID }, data: { value: next } });
  await audit(actor.id, "staff", "SETTINGS_UPDATE", { ...meta, meta: { sections: Object.keys(patch) } });
  return next;
}
