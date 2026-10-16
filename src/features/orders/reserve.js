/* Reserved Units */

import { ANY, isTracked } from "../products/stock.js";

/**
 * Units held by orders that are placed but not yet shipped (to pay, to ship).
 * Never stored: worked out from the orders themselves, so it cannot drift.
 * Available = on hand − held, and is what a shopper can buy.
 */

export const HOLDING = ["to-pay", "to-ship"];
export const ONE_SIZE = "one-size";

export const variantKey = (productId, colorId = ANY, size = ANY) => `${productId}|${colorId}|${size}`;

export function lineSize(line) {
  return line?.size ? String(line.size).toLowerCase() : ONE_SIZE;
}

/** Colour names to ids, for order lines written before lines carried `colorId`. */
export async function colorIdsByName(db) {
  return new Map((await db.color.findMany({ select: { id: true, name: true } })).map((c) => [c.name.toLowerCase(), c.id]));
}

export function lineColorId(line, byName) {
  if (line?.colorId) return line.colorId;
  if (!line?.color) return ANY;
  return byName.get(String(line.color).toLowerCase()) ?? String(line.color);
}

/** The variant a line takes from, for this product: "*" "*" for a piece counted as one number. */
export function variantOf(product, line, byName) {
  if (!isTracked(product)) return { colorId: ANY, size: ANY };
  return { colorId: lineColorId(line, byName), size: lineSize(line) };
}

/**
 * Held units by variant key and by product (`variantKey(id)` is its total).
 * `productIds` narrows the read to the orders that matter for a checkout.
 */
export async function reservedUnits(db, productIds = null) {
  const byName = await colorIdsByName(db);
  const orders = await db.order.findMany({ where: { status: { in: HOLDING } }, select: { items: true } });
  const wanted = productIds ? new Set(productIds) : null;
  const map = new Map();
  const add = (key, n) => map.set(key, (map.get(key) ?? 0) + n);
  for (const order of orders) {
    for (const line of order.items ?? []) {
      if (!line.productId || (wanted && !wanted.has(line.productId))) continue;
      const qty = Number(line.quantity) || 1;
      add(variantKey(line.productId), qty);
      add(variantKey(line.productId, lineColorId(line, byName), lineSize(line)), qty);
    }
  }
  return map;
}

/** A product as a shopper may buy it: on hand with what open orders hold taken off. */
export function withAvailability(product, reserved) {
  const held = (c, s) => reserved.get(variantKey(product.id, c, s)) ?? 0;
  if (!isTracked(product)) return { ...product, stock: Math.max(0, (Number(product.stock) || 0) - held()) };
  const colorways = product.colorways.map((w) =>
    w.stock
      ? { ...w, stock: Object.fromEntries(Object.entries(w.stock).map(([size, n]) => [size, Math.max(0, (Number(n) || 0) - held(w.colorId, size))])) }
      : w,
  );
  const stock = colorways.reduce((sum, w) => sum + Object.values(w.stock ?? {}).reduce((a, n) => a + n, 0), 0);
  return { ...product, colorways, stock };
}
