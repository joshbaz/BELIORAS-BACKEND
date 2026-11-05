/* Fit Model Service */

import { readFileSync } from "node:fs";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { slugify } from "../sizes/slug.js";

/**
 * The models who wear the pieces, with their measurements. Public: the product
 * page shows her card ("Amara is 175 cm and wears S") from this.
 *
 * Ids are permanent and a deleted one is spent, like a colour's: products and
 * bookmarked "shop this edit" links point at it. A model on a live product
 * cannot be deleted.
 */

export const SEED_MODELS = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));
const KIND = "model";

function present(m) {
  if (!m) return null;
  const { createdAt, updatedAt, ...rest } = m;
  return rest;
}

export async function listModels() {
  return (await prisma.fitModel.findMany({ orderBy: { createdAt: "asc" } })).map(present);
}

/** Live products wearing this model, for the delete guard and the usage count. */
async function productsWearing(id = null) {
  const rows = await prisma.product.findMany({
    where: { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
    select: { name: true, attributes: true },
  });
  return rows.filter((p) => (id ? p.attributes?.modelFit?.modelId === id : p.attributes?.modelFit?.modelId));
}

/** How many products each model appears on, keyed by id. */
export async function modelUsage() {
  const counts = {};
  for (const p of await productsWearing()) {
    const id = p.attributes.modelFit.modelId;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

async function resolveId(name) {
  const live = new Set((await prisma.fitModel.findMany({ select: { id: true } })).map((m) => m.id));
  const spent = new Set((await prisma.freedId.findMany({ where: { kind: KIND }, select: { ref: true } })).map((f) => f.ref));
  const base = slugify(name) || "model";
  let id = base;
  for (let n = 2; live.has(id) || spent.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

export async function createModel(fields, actor, meta = {}) {
  const model = await prisma.fitModel.create({ data: { id: await resolveId(fields.name), ...fields } });
  await audit(actor.id, "staff", "MODEL_CREATE", { ...meta, meta: { id: model.id, name: model.name } });
  return present(model);
}

export async function updateModel(id, fields, actor, meta = {}) {
  if (!(await prisma.fitModel.findUnique({ where: { id } }))) throw new ApiError("That model no longer exists.", 404);
  const model = await prisma.fitModel.update({ where: { id }, data: fields });
  await audit(actor.id, "staff", "MODEL_UPDATE", { ...meta, meta: { id, name: model.name } });
  return present(model);
}

export async function deleteModel(id, actor, meta = {}) {
  const model = await prisma.fitModel.findUnique({ where: { id } });
  if (!model) throw new ApiError("That model no longer exists.", 404);
  const wearing = await productsWearing(id);
  if (wearing.length) {
    throw new ApiError(`${model.name} is on ${wearing.length} ${wearing.length === 1 ? "piece" : "pieces"}. Choose another model on them first.`, 409);
  }
  await prisma.$transaction([prisma.fitModel.delete({ where: { id } }), prisma.freedId.create({ data: { kind: KIND, ref: id } })]);
  await audit(actor.id, "staff", "MODEL_DELETE", { ...meta, meta: { id, name: model.name } });
  return present(model);
}

export const seedModel = ({ id, name, photo = null, heightCm = null, bustCm = null, waistCm = null, hipCm = null }) => ({
  id, name, photo, heightCm, bustCm, waistCm, hipCm,
});
