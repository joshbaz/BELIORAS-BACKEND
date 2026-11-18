/* Store Settings Service */

import settingsSeed from "./seed.json" with { type: "json" };
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
const { rev: _rev, ...SEED } = settingsSeed;

/** What `gpsr.manufacturer` used to ship as, with the owner's name in it. */
const OLD_GPSR_NAME = "Belioras \u2013 Online Boutique (Belindah Ongessa)";

export async function getStoreSettings(db = prisma) {
  const row = await db.setting.findUnique({ where: { id: ID } });
  if (row) return upgrade(row.value, db);
  await prisma.setting.upsert({ where: { id: ID }, create: { id: ID, value: SEED }, update: {} });
  return SEED;
}

/**
 * The invoice's seller name used to be `gpsr.manufacturer`, which is also the
 * seller name on every product page. The owner asked for her name to appear
 * only where the law needs it, and the invoice is one such place (§14 UStG),
 * so the invoice now has its own `invoice.sellerName`.
 *
 * Settings saved before that get it once, from what the invoice printed until
 * now, and the product-page name loses the owner's name if it is still the
 * one shipped. Runs on read, so live data needs no separate migration step.
 */
async function upgrade(value, db) {
  if (value.invoice?.sellerName !== undefined) return value;
  const shown = value.gpsr?.manufacturer;
  const next = {
    ...value,
    invoice: { ...(value.invoice ?? {}), sellerName: shown || SEED.invoice.sellerName },
    ...(shown === OLD_GPSR_NAME && { gpsr: { ...value.gpsr, manufacturer: SEED.gpsr.manufacturer } }),
  };
  await db.setting.update({ where: { id: ID }, data: { value: next } });
  return next;
}

/**
 * Settings as anyone may read them, for the storefront. The postal addresses
 * and the invoice's seller name are left out: the owner asked that her name
 * and address appear only in the Impressum (which carries them itself) and on
 * invoices (built on the server). Staff read the full document.
 */
export function publicSettings(settings) {
  const { boutique: _b, boutiqueParts: _bp, ...contact } = settings.contact ?? {};
  const { address: _a, addressParts: _ap, ...gpsr } = settings.gpsr ?? {};
  // The invoice's seller name carries the owner's name; invoices are built here.
  const { sellerName: _sn, ...invoice } = settings.invoice ?? {};
  return { ...settings, contact, gpsr, invoice };
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
