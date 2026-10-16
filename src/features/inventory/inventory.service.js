/* Inventory Service */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { present } from "../products/products.service.js";
import { ANY, onHandOf, withOnHand } from "../products/stock.js";
import { reservedUnits, variantKey } from "../orders/reserve.js";

/**
 * Stock: what is on the shelf, every change to it, and the low-stock line.
 *
 * ## A change and its history are one write
 *
 * Every function here goes through `applyChanges`, which updates the products
 * and writes the movements in one transaction. Each product update is
 * conditional on the `updatedAt` it was read at, and retried if someone else
 * changed the piece in between — so two people receiving stock at once both
 * land, instead of one count silently overwriting the other.
 *
 * ## What open orders hold
 *
 * On hand can't be adjusted below what open orders hold: those pieces are
 * promised. Orders live here, so this is the server's rule; the dashboard
 * checks it first only for a quicker message.
 */

const ATTEMPTS = 8;

/** A short random pause that grows with each retry, so writers that collided do not collide again in lockstep. */
const backOff = (attempt) => new Promise((resolve) => setTimeout(resolve, Math.random() * 15 * 2 ** attempt));

class Conflict extends Error {}

function actorName(actor) {
  return actor?.name ?? actor?.email ?? null;
}

/**
 * Applies `[{ productId, colorId, size, delta, reason, orderId?, note? }]` and
 * writes one movement per real change. `compute(product)` may turn a mode
 * ("set to 5") into a delta against the fresh count, inside the retry.
 * Returns `{ movements, products }` (the products as the client reads them).
 */
async function applyChanges(changes, actor) {
  const real = changes.filter((c) => c.compute || Number(c.delta) !== 0);
  if (!real.length) return { movements: [], products: [] };
  const ids = [...new Set(real.map((c) => c.productId))];
  const by = actorName(actor);

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const rows = await tx.product.findMany({
          where: { id: { in: ids }, OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }] },
        });
        const byId = new Map(rows.map((r) => [r.id, { record: r, flat: present(r) }]));
        const movements = [];

        for (const change of real) {
          const entry = byId.get(change.productId);
          if (!entry) throw new ApiError("That piece no longer exists.", 404);
          const colorId = change.colorId ?? ANY;
          const size = change.size ?? ANY;
          const delta = change.compute ? change.compute(entry.flat, colorId, size) : Number(change.delta);
          const { product, onHandAfter } = withOnHand(entry.flat, colorId, size, delta);
          if (onHandAfter === null) {
            throw new ApiError(`${entry.flat.name} doesn't come in that colour any more.`, 422);
          }
          entry.flat = product;
          movements.push({
            productId: change.productId,
            colorId,
            size,
            delta,
            onHandAfter,
            reason: change.reason,
            orderId: change.orderId ?? null,
            note: change.note?.trim() || null,
            by,
          });
        }

        for (const { record, flat } of byId.values()) {
          const { count } = await tx.product.updateMany({
            where: { id: record.id, updatedAt: record.updatedAt },
            data: { stock: flat.stock, colorways: flat.colorways ?? null },
          });
          if (!count) throw new Conflict();
        }
        const written = movements.filter((m) => m.delta !== 0);
        if (written.length) await tx.stockMovement.createMany({ data: written });
        return { movements: written, products: await freshProducts(tx, ids) };
      });
    } catch (err) {
      if (!(err instanceof Conflict) && err?.code !== "P2034") throw err;
      await backOff(attempt);
    }
  }
  throw new ApiError("Stock was changing too fast to save. Try again.", 409);
}

async function freshProducts(tx, ids) {
  const rows = await tx.product.findMany({ where: { id: { in: ids } } });
  return rows.map((r) => present(r));
}

/** One variant, by mode. `remove` cannot take more than is on the shelf. */
export async function adjustStock({ productId, colorId, size, mode, quantity, reason, note }, actor, meta = {}) {
  if (mode !== "set" && quantity === 0) throw new ApiError("Enter how many pieces, as a whole number.", 422);

  const reserved = await reservedUnits(prisma, [productId]);
  const compute = (product, c, s) => {
    const before = onHandOf(product, c, s);
    if (mode === "remove" && quantity > before) {
      throw new ApiError(`Only ${before} on hand, so ${quantity} can't be removed.`, 409);
    }
    const after = mode === "set" ? quantity : mode === "remove" ? before - quantity : before + quantity;
    if (after === before) throw new ApiError("That leaves the count unchanged.", 422);
    const held = reserved.get(c === ANY ? variantKey(productId) : variantKey(productId, c, s)) ?? 0;
    if (after < held) {
      throw new ApiError(`${held} ${held === 1 ? "is" : "are"} held by open orders, so on hand can't go below ${held}.`, 409);
    }
    return after - before;
  };

  const result = await applyChanges([{ productId, colorId, size, reason, note, compute }], actor);
  await audit(actor.id, "staff", "STOCK_ADJUST", {
    ...meta,
    meta: { productId, colorId, size, mode, quantity, reason },
  });
  return result;
}

/** The same number into each variant: a delivery. */
export async function receiveStock({ variants, quantity, reason, note }, actor, meta = {}) {
  const result = await applyChanges(
    variants.map((v) => ({ ...v, delta: quantity, reason, note })),
    actor,
  );
  await audit(actor.id, "staff", "STOCK_RECEIVE", {
    ...meta,
    meta: { variants: variants.length, quantity, reason },
  });
  return result;
}

/**
 * What an order does to the shelf: "sold" takes its lines off when it ships,
 * "returned" puts lines back. An order ships once, so a second "sold" for the
 * same order is refused rather than taking the pieces twice. Called by the
 * order flows (shipping, refunds with restock), not over HTTP.
 */
export async function orderMovements({ orderId, reason, lines }, actor, meta = {}) {
  if (reason === "sold") {
    const already = await prisma.stockMovement.findFirst({ where: { orderId, reason: "sold" }, select: { id: true } });
    if (already) throw new ApiError(`Stock for order ${orderId} has already been taken off the shelf.`, 409);
  }
  const sign = reason === "sold" ? -1 : 1;
  const result = await applyChanges(
    lines.map(({ quantity, ...v }) => ({ ...v, delta: sign * quantity, reason, orderId })),
    actor,
  );
  await audit(actor.id, "staff", "STOCK_ORDER", {
    ...meta,
    meta: { orderId, reason, units: lines.reduce((n, l) => n + l.quantity, 0) },
  });
  return result;
}

/** One variant's history, newest first. "*" colour means the whole piece; a whole-piece row shows under every variant. */
export async function stockHistory({ productId, colorId = ANY, size = ANY }) {
  const rows = await prisma.stockMovement.findMany({ where: { productId }, orderBy: { at: "desc" }, take: 500 });
  return rows
    .filter(
      (m) =>
        (colorId === ANY || m.colorId === colorId || m.colorId === ANY) &&
        (size === ANY || m.size === size || m.size === ANY),
    )
    .map(({ id, productId: pid, colorId: c, size: s, delta, onHandAfter, reason, orderId, note, by, at }) => ({
      id, productId: pid, colorId: c, size: s, delta, onHandAfter, reason, orderId, note, by, at,
    }));
}

const DEFAULTS = { lowStockThreshold: 3 };

export async function getInventorySettings() {
  const row = await prisma.setting.findUnique({ where: { id: "inventory" } });
  return { ...DEFAULTS, ...(row?.value ?? {}) };
}

export async function setInventorySettings({ lowStockThreshold }, actor, meta = {}) {
  const value = { ...(await getInventorySettings()), lowStockThreshold };
  await prisma.setting.upsert({ where: { id: "inventory" }, create: { id: "inventory", value }, update: { value } });
  await audit(actor.id, "staff", "INVENTORY_SETTINGS", { ...meta, meta: value });
  return value;
}
