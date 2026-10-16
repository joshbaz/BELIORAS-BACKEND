/* Size List Service */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { slugify } from "./slug.js";
import { SEED_SIZES } from "./seed.js";
import { describeUsers, productsUsing } from "../products/products.service.js";

/**
 * The size list.
 *
 * Three rules here, and each exists because the obvious alternative breaks
 * something that is hard to put back.
 *
 * ## The id is permanent
 *
 * A size's id is written into places no migration can follow: it is a key in a
 * product's `colorways[].stock` object, a segment of a bookmarked `?size=eu38,m`
 * URL, and the thing `sizeChartKind.js` pattern-matches to decide which guide a
 * product opens. So `renameSize` has no code path that could change one — not
 * because it is careful, but because there is nothing to change. The store is
 * keyed on the id, so renaming is an update of a different field and nothing
 * else is reachable.
 *
 * ## A deleted id is never reused
 *
 * The subtle one. Deleting "EU 38" does not un-reference it: the products that
 * carried it still do, in that browser's catalogue, and a deleted id reused by
 * tomorrow's "EU 38 (wide)" would silently re-point every one of them — and
 * every stock count keyed on it — at a different size. `_freed` is the record of
 * that, and it is why `freeId` checks it rather than only checking what is
 * currently present.
 *
 * ## Deletion cannot be fully guarded
 *
 * The obvious rule is "a size still offered by a category or a product cannot
 * be deleted", and the client does enforce it. The server cannot, and it would
 * be dishonest to pretend otherwise: there is no `Category` or `Product` model
 * on this server at all — the entire catalogue lives in one browser's
 * localStorage. So the server has no idea a size is in use, and the guard is a
 * courtesy the dashboard performs on the catalogue it can see. A different
 * browser, or a direct call, can still delete a size that is in use. That
 * limitation is the reason the id is never reused: it is what keeps the failure
 * of an unguarded delete to a size that no longer resolves, rather than a size
 * that now means something else.
 */

/** The list, in display order. */
function present(record) {
  if (!record) return null;
  return { id: record.id, name: record.name, position: record.position, updatedAt: record.updatedAt };
}

/** The whole list in the order the facet and the category picker both expect. */
function presentMany(records) {
  return [...records].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(present);
}

/**
 * Where a new size goes.
 *
 * The end of the list. Positions are not renumbered on insert, so a new size
 * cannot shuffle the order of the twelve that are already there — which matters
 * because that order is what a shopper sees and what a category re-sorts into.
 */
async function nextPosition() {
  const last = await prisma.size.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
  return (last?.position ?? -1) + 1;
}

/**
 * An id for a new size.
 *
 * Split in two because a caller that *asked* for an id and a caller that let one
 * be derived need different things. A requested id that is taken is a 409, not a
 * quietly different id: the caller named this row, and handing back `m-2` when
 * it asked for `m` is a 200 that did something other than what it said.
 *
 * A derived id, on the other hand, is only a readability preference, so a
 * collision there just takes the next suffix. Both are checked against the
 * spent set as well as the live one, because a delete leaves the id referenced
 * even though it leaves no row.
 */
async function resolveId(requested, name) {
  const live = new Set((await prisma.size.findMany({ select: { id: true } })).map((t) => t.id));
  const spent = new Set(
    (await prisma.freedId.findMany({ where: { kind: "size" }, select: { ref: true } })).map((f) => f.ref),
  );
  const taken = (id) => live.has(id) || spent.has(id);

  if (requested) {
    if (taken(requested)) throw new ApiError(`The size id "${requested}" is already taken.`, 409);
    return requested;
  }

  // The slug is a starting point, not the id. `sizeChartKind.js` decides which
  // guide a product needs by pattern-matching the id, so a size the shop adds
  // later has to stay readable enough to keep working.
  const base = slugify(name) || "size";
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Every size. Public: this is what the storefront's facet renders. */
export async function listSizes() {
  return presentMany(await prisma.size.findMany());
}

/** One size by its permanent id, or null. */
export async function getSize(id) {
  return present(await prisma.size.findUnique({ where: { id } }));
}

/**
 * Adds a size at the end of the list.
 *
 * Names are compared case- and space-insensitively, so "eu 38" cannot sit
 * beside "EU 38" and leave a shopper with two identical options in a facet.
 */
export async function createSize({ name, id }, actor, meta = {}) {
  const current = await prisma.size.findMany({ select: { name: true } });
  if (current.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())) {
    throw new ApiError(`${name.trim()} is already on the list.`, 409);
  }

  const sizeId = await resolveId(id, name);
  const record = await prisma.size.create({ data: { id: sizeId, name: name.trim(), position: await nextPosition() } });
  await audit(actor.id, "staff", "SIZE_CREATE", { ...meta, meta: { id: sizeId, name: record.name } });
  return present(record);
}

/** Changes the display name and nothing else. The id is not a parameter here, and that is the guarantee. */
export async function renameSize(id, { name }, actor, meta = {}) {
  const current = await prisma.size.findUnique({ where: { id } });
  if (!current) throw new ApiError("That size no longer exists.", 404);

  const others = await prisma.size.findMany({ where: { id: { not: id } }, select: { name: true } });
  if (others.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())) {
    throw new ApiError(`${name.trim()} is already on the list.`, 409);
  }

  const record = await prisma.size.update({ where: { id }, data: { name: name.trim() } });
  await audit(actor.id, "staff", "SIZE_RENAME", { ...meta, meta: { id, from: current.name, to: record.name } });
  return present(record);
}

/**
 * Removes a size, and records its id as spent.
 *
 * The `freed` row is not bookkeeping for its own sake: it is what stops the id
 * being handed to a later size, which is the one way a delete could quietly
 * corrupt a product's stock. It is written in the same call as the delete so
 * there is no window in which the id is free and unrecorded.
 */
export async function deleteSize(id, actor, meta = {}) {
  const current = await prisma.size.findUnique({ where: { id } });
  if (!current) throw new ApiError("That size no longer exists.", 404);

  // Now that categories and products live here, the guard the dashboard used
  // to be alone in enforcing is the server's too.
  const offering = (await prisma.category.findMany({ select: { name: true, sizes: true } })).filter((c) => c.sizes.includes(id));
  if (offering.length) {
    throw new ApiError(`${current.name} is offered by ${offering.map((c) => c.name).join(", ")}. Untick it there first.`, 409);
  }
  const using = await productsUsing({ sizeId: id });
  if (using.length) throw new ApiError(`${current.name} is on ${describeUsers(using)}. Remove it from them first.`, 409);

  await prisma.$transaction([
    prisma.size.delete({ where: { id } }),
    prisma.freedId.create({ data: { ref: id, kind: "size" } }),
  ]);
  await audit(actor.id, "staff", "SIZE_DELETE", { ...meta, meta: { id, name: current.name } });
  return present(current);
}

/**
 * Puts the list back to the shipped twelve, discarding every edit.
 *
 * Every id the dashboard created is marked spent, for the same reason a delete
 * marks one: those ids may already be on a product, and a reset that handed one
 * back out would be a reset that silently re-pointed it.
 */
export async function resetSizes(actor, meta = {}) {
  const seeded = new Set(SEED_SIZES.map((s) => s.id));
  const existing = await prisma.size.findMany({ select: { id: true } });

  for (const row of SEED_SIZES) {
    await prisma.size.upsert({ where: { id: row.id }, create: row, update: { name: row.name, position: row.position } });
  }

  const added = existing.filter((e) => !seeded.has(e.id));
  for (const row of added) {
    await prisma.$transaction([
      prisma.size.delete({ where: { id: row.id } }),
      prisma.freedId.create({ data: { ref: row.id, kind: "size" } }),
    ]);
  }

  await audit(actor.id, "staff", "SIZE_RESET", {
    ...meta,
    meta: { restored: SEED_SIZES.length, removed: added.length },
  });
  return listSizes();
}
