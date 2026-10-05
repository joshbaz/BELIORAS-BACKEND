/* Category Service */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { slugify } from "../sizes/slug.js";
import { SEED_CATEGORIES } from "./seed.js";

/**
 * Categories: what a piece is, the sizes it offers, and its "Shop by …"
 * subcategories, each holding the types products are tagged with.
 *
 * The same three rules as the size list, for the same reasons.
 *
 * ## Ids are permanent
 *
 * A category id is every product's `collectionId`, the `/dresses` URL and a
 * filter token; a subcategory type is a product's `subcat:<sub>:<type>` tag.
 * So an update matches each subcategory and type by
 * the id the client echoes back and keeps it, and only a genuinely new entry
 * gets an id derived from its name. There is no code path that changes the
 * category's own id.
 *
 * ## A deleted category id is never reused
 *
 * Deleting a category spends its id in `FreedId` (kind "category"), so a later
 * category of the same name gets `-2` rather than silently inheriting every
 * product and link still pointing at the old one.
 *
 * ## Deletion and removal cannot be fully guarded
 *
 * "A category that still holds products cannot be deleted" and "a type still
 * tagged on a product cannot be removed" are real rules, and the dashboard enforces them —
 * but products and the Mega Menu still live in the browser, so this server
 * cannot see them. The guards are the client's; what the server guarantees is
 * that an unguarded removal leaves a dangling id rather than a re-pointed one.
 */

const KIND = "category";

function present(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    position: record.position,
    sizes: record.sizes ?? [],
    subcategories: record.subcategories ?? [],
    updatedAt: record.updatedAt,
  };
}

function presentMany(records) {
  return [...records].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(present);
}

const lower = (s) => s.trim().toLowerCase();

/**
 * A flat named list — the subcategories themselves, or one subcategory's
 * types. An entry whose id was in the previous list
 * keeps it across a rename; a new entry gets a slug of its name, suffixed past
 * anything already in either list. A name repeated within the list is a 409.
 */
function cleanNamedList(list, previous, noun) {
  const known = new Set(previous.map((t) => t.id));
  const names = new Set();
  const ids = new Set();

  return list.map((item) => {
    const itemName = item.name.trim();
    if (names.has(lower(itemName))) {
      throw new ApiError(`${itemName} is listed twice. Each ${noun} needs its own name.`, 409);
    }
    names.add(lower(itemName));

    const keep = item.id && known.has(item.id) && !ids.has(item.id);
    const base = slugify(itemName) || noun;
    let id = keep ? item.id : base;
    for (let n = 2; !keep && (ids.has(id) || known.has(id)); n += 1) id = `${base}-${n}`;
    ids.add(id);
    return { id, name: itemName };
  });
}

function cleanSubcategories(subcategories, previous) {
  const previousById = new Map(previous.map((s) => [s.id, s]));
  const shells = cleanNamedList(subcategories, previous, "subcategory");
  return shells.map((shell, i) => ({
    ...shell,
    types: cleanNamedList(subcategories[i].types ?? [], previousById.get(shell.id)?.types ?? [], "type"),
  }));
}

/** Validated body to stored fields, preserving child ids against `existing`. */
function clean(body, existing = null) {
  return {
    name: body.name.trim(),
    sizes: [...new Set(body.sizes ?? [])],
    subcategories: cleanSubcategories(body.subcategories ?? [], existing?.subcategories ?? []),
  };
}

async function assertNameFree(name, exceptId = null) {
  const others = await prisma.category.findMany({
    where: exceptId ? { id: { not: exceptId } } : {},
    select: { name: true },
  });
  const clash = others.find((c) => lower(c.name) === lower(name));
  if (clash) throw new ApiError(`There is already a category called ${clash.name}.`, 409);
}

/** A derived id, suffixed past both the live and the spent sets. */
async function resolveId(name) {
  const live = new Set((await prisma.category.findMany({ select: { id: true } })).map((c) => c.id));
  const spent = new Set(
    (await prisma.freedId.findMany({ where: { kind: KIND }, select: { ref: true } })).map((f) => f.ref),
  );
  const taken = (id) => live.has(id) || spent.has(id);
  const base = slugify(name) || "category";
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

async function nextPosition() {
  const last = await prisma.category.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
  return (last?.position ?? -1) + 1;
}

/** Every category, in display order. Public: the storefront's filters and menu read this. */
export async function listCategories() {
  return presentMany(await prisma.category.findMany());
}

export async function getCategory(id) {
  return present(await prisma.category.findUnique({ where: { id } }));
}

/** Adds a category at the end of the list. */
export async function createCategory(body, actor, meta = {}) {
  const fields = clean(body);
  await assertNameFree(fields.name);
  const id = await resolveId(fields.name);
  const record = await prisma.category.create({ data: { id, position: await nextPosition(), ...fields } });
  await audit(actor.id, "staff", "CATEGORY_CREATE", { ...meta, meta: { id, name: record.name } });
  return present(record);
}

/** Replaces name, sizes, types and subcategories. The id and position are not reachable from here. */
export async function updateCategory(id, body, actor, meta = {}) {
  const current = await prisma.category.findUnique({ where: { id } });
  if (!current) throw new ApiError("That category no longer exists.", 404);

  const fields = clean(body, current);
  await assertNameFree(fields.name, id);
  const record = await prisma.category.update({ where: { id }, data: fields });
  await audit(actor.id, "staff", "CATEGORY_UPDATE", {
    ...meta,
    meta: { id, from: current.name, to: record.name },
  });
  return present(record);
}

/** Removes a category and spends its id, in one transaction. */
export async function deleteCategory(id, actor, meta = {}) {
  const current = await prisma.category.findUnique({ where: { id } });
  if (!current) throw new ApiError("That category no longer exists.", 404);

  await prisma.$transaction([
    prisma.category.delete({ where: { id } }),
    prisma.freedId.create({ data: { ref: id, kind: KIND } }),
  ]);
  await audit(actor.id, "staff", "CATEGORY_DELETE", { ...meta, meta: { id, name: current.name } });
  return present(current);
}

/**
 * Sets the display order from a complete list of ids.
 *
 * The list has to be exactly the current set — no missing, extra or repeated
 * ids — so a dashboard working from a stale list is told so (409) rather than
 * having its order half-applied over a category someone else just added.
 */
export async function reorderCategories({ ids }, actor, meta = {}) {
  const live = (await prisma.category.findMany({ select: { id: true } })).map((c) => c.id);
  const sent = new Set(ids);
  if (sent.size !== ids.length || sent.size !== live.length || live.some((id) => !sent.has(id))) {
    throw new ApiError("The category list has changed since it was loaded. Reload and try again.", 409);
  }

  await prisma.$transaction(ids.map((id, position) => prisma.category.update({ where: { id }, data: { position } })));
  await audit(actor.id, "staff", "CATEGORY_REORDER", { ...meta, meta: { ids } });
  return listCategories();
}

/** Back to the shipped categories. Ids the dashboard created are spent, as a delete would. */
export async function resetCategories(actor, meta = {}) {
  const seeded = new Set(SEED_CATEGORIES.map((c) => c.id));
  const existing = await prisma.category.findMany({ select: { id: true } });

  for (const row of SEED_CATEGORIES) {
    const { id, ...data } = row;
    await prisma.category.upsert({ where: { id }, create: row, update: data });
  }

  const added = existing.filter((e) => !seeded.has(e.id));
  for (const row of added) {
    await prisma.$transaction([
      prisma.category.delete({ where: { id: row.id } }),
      prisma.freedId.create({ data: { ref: row.id, kind: KIND } }),
    ]);
  }

  await audit(actor.id, "staff", "CATEGORY_RESET", {
    ...meta,
    meta: { restored: SEED_CATEGORIES.length, removed: added.length },
  });
  return listCategories();
}
