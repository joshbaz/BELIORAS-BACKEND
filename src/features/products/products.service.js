/* Product Service */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { slugify } from "../sizes/slug.js";
import { mergeStock, stockDiff, withTotal } from "./stock.js";

/**
 * The catalogue.
 *
 * ## Ids and addresses are permanent
 *
 * A product id is what order lines and the stock history point at, so it is
 * never changed and never reissued: delete is soft (`deletedAt`), and a new id
 * is numbered past every row, deleted ones included. The slug is the product's
 * URL; it moves only when the name does, and is unique across every row so an
 * Undo can always bring a deleted piece back at its old address.
 *
 * ## The server checks what it can now see
 *
 * Categories, colours and sizes live here too, so a write is refused if it
 * files a piece under a category, colour, size or subcategory type that does
 * not exist — and those resources' own deletes now ask this module whether a
 * live piece still uses them.
 *
 * ## Stock and its history move together
 *
 * A save that changes on hand writes the history rows for the difference in
 * the same transaction. `stock` is recomputed from the colourways for a piece
 * counted per colour and size, never taken from the client.
 */

/** Fields stored as columns; everything else is `attributes`. */
const COLUMNS = ["id", "slug", "name", "status", "collectionId", "price", "stock", "sizes", "tags", "colorways"];

/** One flat object, as the client has always read a product. */
export function present(record, { audience = "staff" } = {}) {
  if (!record) return null;
  const { attributes, colorways, deletedAt, editVersion, ...columns } = record;
  const flat = { ...(attributes ?? {}), ...columns, ...(colorways ? { colorways } : {}) };
  if (audience === "public") delete flat.costPrice;
  else flat.editVersion = editVersion ?? 1;
  return flat;
}

/** A flat product to a row: known columns, the rest in `attributes`. */
function toRecord(flat) {
  const attributes = {};
  const record = {};
  for (const [key, value] of Object.entries(flat)) {
    if (["createdAt", "updatedAt", "deletedAt", "editVersion"].includes(key)) continue;
    if (COLUMNS.includes(key)) record[key] = value;
    else if (value !== undefined) attributes[key] = value;
  }
  return { ...record, colorways: record.colorways ?? null, attributes, deletedAt: null };
}

/** A shipped product as a row, for the seed script. Validation is skipped: these are the pieces the shop already had. */
export function seedRecord(flat) {
  return { id: flat.id, ...toRecord(withTotal(flat)), createdAt: flat.createdAt ? new Date(flat.createdAt) : new Date() };
}

/**
 * Not deleted. On MongoDB, `deletedAt: null` matches only a field explicitly
 * set to null, not one that was never written, so both are asked for.
 */
const LIVE = { OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] };

/** Every live piece, newest first. `audience: "public"` shows only active ones, without cost price. */
export async function listProducts({ audience = "staff" } = {}) {
  const where = audience === "public" ? { AND: [LIVE, { status: "active" }] } : LIVE;
  const rows = await prisma.product.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  return rows.map((r) => present(r, { audience }));
}

/** One piece by id or slug. The public read 404s a draft, so an unpublished piece has no address. */
export async function getProduct(idOrSlug, { audience = "staff" } = {}) {
  const row = await prisma.product.findFirst({ where: { AND: [LIVE, { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }] } });
  if (!row || (audience === "public" && row.status !== "active")) return null;
  return present(row, { audience });
}

/** The next `p<n>`, past every id ever issued — the shipped `bf33` counts as 33, as it always has. */
async function nextId() {
  const ids = await prisma.product.findMany({ select: { id: true } });
  const highest = ids.reduce((max, { id }) => Math.max(max, Number(String(id).match(/\d+/)?.[0] ?? 0)), 0);
  return `p${highest + 1}`;
}

async function uniqueSlug(base, ignoreId = null) {
  const root = base || "product";
  const rows = await prisma.product.findMany({
    where: { slug: { startsWith: root }, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
    select: { slug: true },
  });
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

/**
 * Refuses a piece filed under something that does not exist. Checked against
 * the resources' own tables, which is the point of having moved them here.
 */
async function assertFiling(product) {
  const category = await prisma.category.findUnique({ where: { id: product.collectionId } });
  if (!category) throw new ApiError("That category no longer exists. Choose another.", 422);

  const colorIds = (product.colorways ?? []).map((w) => w.colorId);
  if (colorIds.length) {
    if (new Set(colorIds).size !== colorIds.length) throw new ApiError("Each colour can only be added once.", 422);
    const found = await prisma.color.findMany({ where: { id: { in: colorIds } }, select: { id: true } });
    const known = new Set(found.map((c) => c.id));
    const missing = colorIds.find((id) => !known.has(id));
    if (missing) throw new ApiError(`The colour "${missing}" no longer exists. Remove it from this piece.`, 422);
  }

  const sizes = new Set(product.sizes ?? []);
  for (const w of product.colorways ?? []) for (const size of Object.keys(w.stock ?? {})) sizes.add(size);
  if (sizes.size) {
    const found = await prisma.size.findMany({ where: { id: { in: [...sizes] } }, select: { id: true } });
    const known = new Set(found.map((s) => s.id));
    const missing = [...sizes].find((id) => !known.has(id));
    if (missing) throw new ApiError(`The size "${missing}" is no longer on the size list.`, 422);
  }

  for (const tag of product.tags ?? []) {
    const [prefix, subId, typeId] = String(tag).split(":");
    if (prefix !== "subcat") throw new ApiError("Only subcategory types can be saved as tags.", 422);
    const sub = (category.subcategories ?? []).find((s) => s.id === subId);
    if (!sub?.types?.some((t) => t.id === typeId)) {
      throw new ApiError(`${category.name} has no "${typeId}" under that subcategory any more. Untick it and save again.`, 422);
    }
  }
}

/** Movements to write for a stock change, attributed to the person who made it. */
function movementRows(rows, actor) {
  const by = actor?.name ?? actor?.email ?? null;
  return rows.map((r) => ({ orderId: null, note: null, ...r, by }));
}

export async function createProduct(body, actor, meta = {}) {
  const draft = withTotal({
    ...body,
    name: body.name.trim(),
    status: body.status ?? "draft",
    sizes: body.sizes ?? [],
    tags: body.tags ?? [],
    stock: body.stock ?? 0,
    images: body.images ?? [],
  });
  await assertFiling(draft);

  // Two creates racing for the same next id: the second hits the unique _id and tries the one after.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = await nextId();
    const slug = await uniqueSlug(slugify(body.slug || draft.name));
    const product = { ...draft, id, slug };
    try {
      const record = await prisma.$transaction(async (tx) => {
        const created = await tx.product.create({ data: toRecord(product) });
        const moves = movementRows(stockDiff(null, product), actor);
        if (moves.length) await tx.stockMovement.createMany({ data: moves });
        return created;
      });
      await audit(actor.id, "staff", "PRODUCT_CREATE", { ...meta, meta: { id, name: product.name } });
      return present(record);
    } catch (err) {
      if (err?.code !== "P2002") throw err;
    }
  }
  throw new ApiError("Could not number the new product. Try again.", 409);
}

class StaleRead extends Error {}

/**
 * Saves a form edit.
 *
 * Two optional fields make it safe to have the form open for a while:
 *
 *   - `ifEditVersion`: the version the form opened. If someone else has saved
 *     the piece since, the save is refused (409) rather than overwriting their
 *     name, price or photos. Stock moving does not bump it, so a busy shop does
 *     not make every save look stale.
 *   - `stockBase`: the stock the form loaded. With it, only the cells the editor
 *     changed move, by the editor's difference, applied to today's count — see
 *     `mergeStock`. Without it, the stock sent is taken as-is (bulk edits that
 *     do not touch stock never send any).
 *
 * The write is conditional on the row not having changed since it was read
 * (stock moves included) and retried, so the merge is always against the
 * count that is really there.
 */
export async function updateProduct(id, input, actor, meta = {}) {
  const { ifEditVersion, stockBase, ...patch } = input;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await prisma.product.findFirst({ where: { AND: [{ id }, LIVE] } });
    if (!current) throw new ApiError("Product not found.", 404);
    if (ifEditVersion !== undefined && (current.editVersion ?? 1) !== ifEditVersion) {
      throw new ApiError("Someone else saved this piece while you were editing. Reload it to see their changes, then make yours again.", 409);
    }
    const before = present(current);

    const name = patch.name !== undefined ? patch.name.trim() : before.name;
    let next = withTotal({ ...before, ...patch, id, name });
    if (stockBase) next = mergeStock(before, next, stockBase);
    // A new address only when the name actually changed, so an unrelated edit
    // never breaks a shared link.
    next.slug = name !== before.name ? await uniqueSlug(slugify(name), id) : before.slug;
    // Colourways replace the older per-name colour fields for good.
    if (Array.isArray(patch.colorways)) {
      delete next.colors;
      delete next.colorImages;
    }
    await assertFiling(next);

    try {
      const record = await prisma.$transaction(async (tx) => {
        // The id is the key, never data: re-sending it would be a write to `_id`.
        const { id: _key, ...data } = toRecord(next);
        const { count } = await tx.product.updateMany({
          where: { id, updatedAt: current.updatedAt },
          data: { ...data, editVersion: (current.editVersion ?? 1) + 1 },
        });
        if (!count) throw new StaleRead();
        const moves = movementRows(stockDiff(before, next), actor);
        if (moves.length) await tx.stockMovement.createMany({ data: moves });
        return tx.product.findUnique({ where: { id } });
      });
      await audit(actor.id, "staff", "PRODUCT_UPDATE", {
        ...meta,
        meta: { id, name: record.name, fields: Object.keys(patch) },
      });
      return present(record);
    } catch (err) {
      if (!(err instanceof StaleRead) && err?.code !== "P2034") throw err;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 15 * 2 ** attempt));
    }
  }
  throw new ApiError("This piece was changing too fast to save. Try again.", 409);
}

/** Hides the piece everywhere. The row stays, so its id is never reissued and Undo can bring it back. */
export async function deleteProduct(id, actor, meta = {}) {
  const current = await prisma.product.findFirst({ where: { AND: [{ id }, LIVE] } });
  if (!current) throw new ApiError("Product not found.", 404);
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(actor.id, "staff", "PRODUCT_DELETE", { ...meta, meta: { id, name: current.name } });
  return present(current);
}

export async function restoreProduct(id, actor, meta = {}) {
  const current = await prisma.product.findUnique({ where: { id } });
  if (!current) throw new ApiError("Product not found.", 404);
  if (!current.deletedAt) return present(current);
  const record = await prisma.product.update({ where: { id }, data: { deletedAt: null } });
  await audit(actor.id, "staff", "PRODUCT_RESTORE", { ...meta, meta: { id, name: record.name } });
  return present(record);
}

/**
 * How many live pieces still use something, for the guards on categories,
 * colours and sizes. Read in JS rather than queried: colourways are JSON, and
 * the catalogue is small enough that one read is cheaper than being clever.
 */
export async function productsUsing({ collectionId, colorId, sizeId, subcategory }) {
  const rows = await prisma.product.findMany({
    where: collectionId ? { AND: [LIVE, { collectionId }] } : LIVE,
    select: { name: true, sizes: true, tags: true, colorways: true },
  });
  return rows.filter((p) => {
    if (colorId) return (p.colorways ?? []).some((w) => w.colorId === colorId);
    if (sizeId) return p.sizes.includes(sizeId) || (p.colorways ?? []).some((w) => w.stock && sizeId in w.stock);
    if (subcategory) return p.tags.includes(`subcat:${subcategory.sub}:${subcategory.type}`);
    return true;
  });
}

/** "3 products (Ebony Gown, …)" for a guard's message. */
export function describeUsers(rows) {
  const names = rows.slice(0, 3).map((p) => p.name).join(", ");
  return `${rows.length} ${rows.length === 1 ? "product" : "products"} (${names}${rows.length > 3 ? "…" : ""})`;
}
