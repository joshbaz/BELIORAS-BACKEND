/* Navigation Service */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { SEED_NAVIGATION } from "./seed.js";

/**
 * The mega menu: one tree, read whole and saved whole.
 *
 * A save carries the `version` it was edited from and is refused if the menu
 * has moved on since (409). Without that, two people with the editor open
 * would each save over the other, and the first person's work would vanish
 * without either of them being told.
 *
 * The document is created from the seed on first read, so a fresh database
 * serves the shipped menu without a separate seed step.
 */

const ID = "main";

function present(record) {
  return { items: record.items, version: record.version, updatedAt: record.updatedAt };
}

async function current() {
  const found = await prisma.navigation.findUnique({ where: { id: ID } });
  if (found) return found;
  // Upsert rather than create: two first reads racing must not both fail.
  return prisma.navigation.upsert({ where: { id: ID }, create: { id: ID, items: SEED_NAVIGATION }, update: {} });
}

export async function getNavigation() {
  return present(await current());
}

export async function updateNavigation({ items, version }, actor, meta = {}) {
  const before = await current();
  // Conditional update: only lands if nobody saved in between, even under a race.
  const { count } = await prisma.navigation.updateMany({
    where: { id: ID, version },
    data: { items, version: { increment: 1 } },
  });
  if (!count) {
    throw new ApiError("Someone else saved the menu while you were editing. Reload to see their changes, then make yours again.", 409, {
      details: { currentVersion: before.version },
    });
  }
  const record = await prisma.navigation.findUnique({ where: { id: ID } });
  await audit(actor.id, "staff", "NAVIGATION_UPDATE", {
    ...meta,
    meta: { version: record.version, items: items.length },
  });
  return present(record);
}

/** Back to the shipped menu. Bumps the version, so any open editor's save is refused rather than undoing the reset. */
export async function resetNavigation(actor, meta = {}) {
  await current();
  const record = await prisma.navigation.update({
    where: { id: ID },
    data: { items: SEED_NAVIGATION, version: { increment: 1 } },
  });
  await audit(actor.id, "staff", "NAVIGATION_RESET", { ...meta, meta: { version: record.version } });
  return present(record);
}
