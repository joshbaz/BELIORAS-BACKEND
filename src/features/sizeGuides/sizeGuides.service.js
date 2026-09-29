/* Size Guides Service */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { GUIDE_TYPES } from "../../versions/v1/schemas/sizeGuides.schema.js";
import { SEED_SIZE_GUIDES } from "./seed.js";

/**
 * The three size guides.
 *
 * One document per guide, and a guide is written whole. That is the point: a
 * `PUT` replaces a complete guide, so a row that fails validation leaves the
 * previous guide exactly as it was. Saving a guide as separate calls per table
 * is how a guide ends up with new measurements and the old instructions — the
 * change either lands or it does not.
 *
 * `data` is the guide verbatim rather than normalised into rows, because the
 * three shapes are unrelated to each other (a body range, a shoe conversion, a
 * length) and nothing queries across them. `type` decides what is legal in
 * `data`, and the zod schema is the enforcement; Prisma does not enforce enums
 * on MongoDB, so a `type` here is trusted only because the route checks it first.
 */

/** The guide's own document, without the store's bookkeeping. */
function present(record) {
  if (!record) return null;
  return { type: record.type, ...record.data, updatedAt: record.updatedAt };
}

/** All three, always keyed by every type, so a caller never has to handle a missing one. */
function presentAll(records) {
  const byType = new Map(records.map((r) => [r.type, present(r)]));
  return Object.fromEntries(GUIDE_TYPES.map((type) => [type, byType.get(type) ?? null]));
}

/** Every size guide. Public: this is what the storefront renders. */
export async function listGuides() {
  const records = await prisma.sizeGuide.findMany();
  return presentAll(records);
}

/** One guide, or null. */
export async function getGuide(type) {
  return present(await prisma.sizeGuide.findUnique({ where: { type } }));
}

/**
 * Replaces one guide outright.
 *
 * `guide` has already been through zod, so this is a write, not a judgement.
 * Upsert rather than create-then-update: the store holds exactly one document
 * per type by construction, and a first-run seed can race a save.
 *
 * The audit row names the counts, not the measurements. A size guide is the one
 * thing in the shop that describes bodies, and an audit log is the wrong place
 * for a copy of it.
 */
export async function saveGuide(type, guide, actor, meta = {}) {
  const record = await prisma.sizeGuide.upsert({
    where: { type },
    create: { type, data: guide },
    update: { data: guide },
  });
  await audit(actor.id, "staff", "SIZE_GUIDE_UPDATE", {
    ...meta,
    meta: { type, rows: countRows(guide) },
  });
  return present(record);
}

/** Puts a guide back to the shipped version, discarding every edit to it. */
export async function resetGuide(type, actor, meta = {}) {
  const seeded = SEED_SIZE_GUIDES[type];
  if (!seeded) throw new ApiError("Unknown size guide.", 404);
  const record = await prisma.sizeGuide.upsert({
    where: { type },
    create: { type, data: seeded },
    update: { data: seeded },
  });
  await audit(actor.id, "staff", "SIZE_GUIDE_RESET", {
    ...meta,
    meta: { type },
  });
  return present(record);
}

/** Puts all three back at once, which is what the dashboard's one reset button does. */
export async function resetGuides(actor, meta = {}) {
  for (const type of GUIDE_TYPES) await resetGuide(type, actor, meta);
  return listGuides();
}

/** How many rows a guide holds, for the audit row and nothing else. */
function countRows(guide) {
  if (Array.isArray(guide.rows)) return guide.rows.length;
  if (Array.isArray(guide.lengths)) return guide.lengths.length;
  return 0;
}
