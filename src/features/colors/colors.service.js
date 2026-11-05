/* Colour Service */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { slugify } from "../sizes/slug.js";
import { SEED_COLORS } from "./seed.js";
import { assertFamily } from "./families.service.js";
import { describeUsers, productsUsing } from "../products/products.service.js";

/**
 * The colour list: a boutique name, a swatch, and the shop filter family.
 *
 * Same rules as sizes and categories. The id is permanent — products store
 * their colourways by it — so an update changes name, hex and family only.
 * A deleted id is spent (`FreedId` kind "color") so a later colour of the same
 * name cannot inherit the colourways still pointing at the old one. And the
 * "still on a product" delete guard is the dashboard's, because products live
 * in the browser; the spent id is what bounds an unguarded delete.
 */

const KIND = "color";

function present(record) {
  if (!record) return null;
  return { id: record.id, name: record.name, hex: record.hex, family: record.family, updatedAt: record.updatedAt };
}

/** Alphabetical, as the dashboard, the product form and the swatch pickers all list them. */
function presentMany(records) {
  return [...records].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(present);
}

const lower = (s) => s.trim().toLowerCase();

async function assertNameFree(name, exceptId = null) {
  const others = await prisma.color.findMany({
    where: exceptId ? { id: { not: exceptId } } : {},
    select: { name: true },
  });
  const clash = others.find((c) => lower(c.name) === lower(name));
  if (clash) throw new ApiError(`There is already a colour called ${clash.name}.`, 409);
}

async function resolveId(name) {
  const live = new Set((await prisma.color.findMany({ select: { id: true } })).map((c) => c.id));
  const spent = new Set(
    (await prisma.freedId.findMany({ where: { kind: KIND }, select: { ref: true } })).map((f) => f.ref),
  );
  const taken = (id) => live.has(id) || spent.has(id);
  const base = slugify(name) || "colour";
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Every colour. Public: every product read resolves its colourways through this. */
export async function listColors() {
  return presentMany(await prisma.color.findMany());
}

export async function getColor(id) {
  return present(await prisma.color.findUnique({ where: { id } }));
}

export async function createColor({ name, hex, family }, actor, meta = {}) {
  await assertNameFree(name);
  await assertFamily(family);
  const id = await resolveId(name);
  const record = await prisma.color.create({ data: { id, name: name.trim(), hex, family } });
  await audit(actor.id, "staff", "COLOR_CREATE", { ...meta, meta: { id, name: record.name } });
  return present(record);
}

/** Name, swatch and family. The id is not reachable from here. */
export async function updateColor(id, { name, hex, family }, actor, meta = {}) {
  const current = await prisma.color.findUnique({ where: { id } });
  if (!current) throw new ApiError("That colour no longer exists.", 404);

  await assertNameFree(name, id);
  await assertFamily(family);
  const record = await prisma.color.update({ where: { id }, data: { name: name.trim(), hex, family } });
  await audit(actor.id, "staff", "COLOR_UPDATE", { ...meta, meta: { id, from: current.name, to: record.name } });
  return present(record);
}

/** Removes a colour and spends its id, in one transaction. */
export async function deleteColor(id, actor, meta = {}) {
  const current = await prisma.color.findUnique({ where: { id } });
  if (!current) throw new ApiError("That colour no longer exists.", 404);

  const using = await productsUsing({ colorId: id });
  if (using.length) throw new ApiError(`${current.name} is on ${describeUsers(using)}. Remove it from them first.`, 409);

  await prisma.$transaction([
    prisma.color.delete({ where: { id } }),
    prisma.freedId.create({ data: { ref: id, kind: KIND } }),
  ]);
  await audit(actor.id, "staff", "COLOR_DELETE", { ...meta, meta: { id, name: current.name } });
  return present(current);
}

/** Back to the shipped list. Ids the dashboard created are spent, as a delete would. */
export async function resetColors(actor, meta = {}) {
  const seeded = new Set(SEED_COLORS.map((c) => c.id));
  const existing = await prisma.color.findMany({ select: { id: true } });

  for (const row of SEED_COLORS) {
    const { id, ...data } = row;
    await prisma.color.upsert({ where: { id }, create: row, update: data });
  }

  const added = existing.filter((e) => !seeded.has(e.id));
  for (const row of added) {
    await prisma.$transaction([
      prisma.color.delete({ where: { id: row.id } }),
      prisma.freedId.create({ data: { ref: row.id, kind: KIND } }),
    ]);
  }

  await audit(actor.id, "staff", "COLOR_RESET", { ...meta, meta: { restored: SEED_COLORS.length, removed: added.length } });
  return listColors();
}
