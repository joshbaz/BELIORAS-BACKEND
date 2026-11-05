/* Colour Families Service */

import { readFileSync } from "node:fs";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";

/**
 * The shop-filter colour families — black, brown, red… Each boutique colour
 * names one (`Color.family`), and the storefront's colour filter and every
 * mega-menu `filter:color` link resolve by these ids, so they are permanent:
 * a family a colour still uses cannot be removed. One document, created from
 * the shipped list on first read.
 */

const ID = "taxonomy:color";
const SEED = JSON.parse(readFileSync(new URL("./families.seed.json", import.meta.url), "utf8"));

export async function getFamilies() {
  const row = await prisma.setting.findUnique({ where: { id: ID } });
  if (row) return row.value;
  await prisma.setting.upsert({ where: { id: ID }, create: { id: ID, value: SEED }, update: {} });
  return SEED;
}

export async function assertFamily(id) {
  const { values } = await getFamilies();
  if (!values.some((f) => f.id === id)) throw new ApiError("Choose a shop filter family that exists.", 422);
}

/** Replaces the list. Names, swatches and order may change; an id in use may not disappear. */
export async function updateFamilies({ label, values }, actor, meta = {}) {
  const ids = values.map((v) => v.id);
  if (new Set(ids).size !== ids.length) throw new ApiError("Each family needs its own id.", 422);
  const kept = new Set(ids);
  const used = await prisma.color.findMany({ where: { family: { notIn: [...kept] } }, select: { name: true, family: true } });
  if (used.length) {
    throw new ApiError(`${used[0].name} is in the ${used[0].family} family. Move it to another before removing that family.`, 409);
  }
  const current = await getFamilies();
  const value = { label: label ?? current.label, values };
  await prisma.setting.update({ where: { id: ID }, data: { value } });
  await audit(actor.id, "staff", "TAXONOMY_UPDATE", { ...meta, meta: { families: ids.length } });
  return value;
}
