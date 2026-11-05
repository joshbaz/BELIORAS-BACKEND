/* Role Service */

import { readFileSync } from "node:fs";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { slugify } from "../sizes/slug.js";
import { LEVELS, SECTIONS, levelIn, rank } from "./sections.js";

/**
 * Dashboard roles, and the question every staff route asks: what level does
 * this person's role give them in this section?
 *
 * Three rules hold, so the team can never lock itself out or hand out more
 * than it has: the Administrator role is locked; nobody edits the role they
 * hold; and nobody grants a level they do not hold themselves.
 *
 * Roles are read on every guarded request, so they are cached in memory and
 * the cache is dropped on every role write. Another server instance sees a
 * change within `TTL_MS`.
 */

export const SEED_ROLES = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));
export const ADMIN = "super-admin";
const TTL_MS = 30_000;

let cache = { at: 0, byId: null };
const invalidate = () => {
  cache = { at: 0, byId: null };
};

/** Creates the shipped roles the first time roles are read, so a fresh database has them. */
async function ensureSeeded() {
  if ((await prisma.role.count()) > 0) return;
  for (const r of SEED_ROLES) {
    await prisma.role.upsert({
      where: { id: r.id },
      create: { id: r.id, name: r.name, description: r.description ?? "", permissions: r.permissions ?? {}, locked: Boolean(r.locked) },
      update: {},
    });
  }
}

async function rolesById() {
  if (cache.byId && Date.now() - cache.at < TTL_MS) return cache.byId;
  await ensureSeeded();
  const rows = await prisma.role.findMany();
  cache = { at: Date.now(), byId: new Map(rows.map((r) => [r.id, r])) };
  return cache.byId;
}

export async function getRole(id) {
  return (await rolesById()).get(id) ?? null;
}

/** "none", "view" or "edit" — what `roleId` gives in `section`. */
export async function levelFor(roleId, section) {
  return levelIn(await getRole(roleId), section);
}

function present(r, members = 0) {
  return { id: r.id, name: r.name, description: r.description, permissions: r.permissions, ...(r.locked ? { locked: true } : {}), members };
}

/** Every role, with how many staff hold it. Readable by all staff: it is what draws their dashboard. */
export async function listRoles() {
  const roles = [...(await rolesById()).values()];
  const users = await prisma.user.findMany({ where: { realm: "staff" }, select: { role: true } });
  const counts = users.reduce((m, u) => m.set(u.role, (m.get(u.role) ?? 0) + 1), new Map());
  const order = SEED_ROLES.map((r) => r.id);
  return roles
    .sort((a, b) => ((order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99)) || a.createdAt - b.createdAt)
    .map((r) => present(r, counts.get(r.id) ?? 0));
}

/** Refuses a role that reaches further than the person giving it. */
export async function assertWithinReach(role, actor) {
  const actorRole = await getRole(actor?.role);
  if (role.locked && !actorRole?.locked) throw new ApiError("Only an Administrator can make someone an Administrator.", 403);
  for (const s of SECTIONS) {
    if (rank(levelIn(role, s.id)) > rank(levelIn(actorRole, s.id))) {
      throw new ApiError(`You can't give ${s.id.replace("-", " ")} access beyond your own.`, 403);
    }
  }
}

async function clean({ name, description, permissions }, existingId = null) {
  const trimmed = name.trim();
  const clash = [...(await rolesById()).values()].find((r) => r.id !== existingId && r.name.toLowerCase() === trimmed.toLowerCase());
  if (clash) throw new ApiError(`There is already a role called ${clash.name}.`, 409);
  const kept = {};
  for (const s of SECTIONS) {
    const level = LEVELS.includes(permissions?.[s.id]) ? permissions[s.id] : "none";
    if (level !== "none") kept[s.id] = s.readOnly && level === "edit" ? "view" : level;
  }
  if (!Object.keys(kept).length) throw new ApiError("Give the role access to at least one section.", 422);
  return { name: trimmed, description: (description ?? "").trim(), permissions: kept };
}

export async function createRole(input, actor, meta = {}) {
  const fields = await clean(input);
  await assertWithinReach(fields, actor);
  const byId = await rolesById();
  const base = slugify(fields.name) || "role";
  let id = base;
  for (let n = 2; byId.has(id) || id === "customer"; n += 1) id = `${base}-${n}`;
  const role = await prisma.role.create({ data: { id, ...fields } });
  invalidate();
  await audit(actor.id, "staff", "ROLE_CREATE", { ...meta, meta: { id } });
  return present(role);
}

export async function updateRole(id, input, actor, meta = {}) {
  const existing = await getRole(id);
  if (!existing) throw new ApiError("That role no longer exists.", 404);
  if (existing.locked) throw new ApiError("The Administrator role always has everything and can't be edited.", 403);
  if (actor.role === id) throw new ApiError("You can't edit the role you hold yourself.", 403);
  const fields = await clean(input, id);
  await assertWithinReach(fields, actor);
  const role = await prisma.role.update({ where: { id }, data: fields });
  invalidate();
  await audit(actor.id, "staff", "ROLE_UPDATE", { ...meta, meta: { id } });
  return present(role);
}

export async function deleteRole(id, actor, meta = {}) {
  const role = await getRole(id);
  if (!role) throw new ApiError("That role no longer exists.", 404);
  if (role.locked) throw new ApiError("The Administrator role can't be deleted.", 403);
  const holders = await prisma.user.count({ where: { realm: "staff", role: id } });
  if (holders) throw new ApiError(`${holders} ${holders === 1 ? "person has" : "people have"} this role. Give them another role first.`, 409);
  await prisma.role.delete({ where: { id } });
  invalidate();
  await audit(actor.id, "staff", "ROLE_DELETE", { ...meta, meta: { id } });
  return present(role);
}

/** For tests and the seed script: forget cached roles. */
export const resetRoleCache = invalidate;
