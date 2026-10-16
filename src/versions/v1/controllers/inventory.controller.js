/* Inventory Controller */

import * as inventory from "../../../features/inventory/inventory.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/** Stock changes, history and the low-stock line. Changes answer `{ movements, products }`. */

export async function adjustStock(req, res) {
  res.json({ data: await inventory.adjustStock(req.body, req.user, requestMeta(req)) });
}

export async function receiveStock(req, res) {
  res.json({ data: await inventory.receiveStock(req.body, req.user, requestMeta(req)) });
}

export async function stockHistory(req, res) {
  const { productId, colorId, size } = req.query;
  if (!productId) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "Say which product." } });
  res.json({ data: await inventory.stockHistory({ productId: String(productId), colorId: colorId ? String(colorId) : undefined, size: size ? String(size) : undefined }) });
}

export async function getInventorySettings(req, res) {
  res.json({ data: await inventory.getInventorySettings() });
}

export async function setInventorySettings(req, res) {
  res.json({ data: await inventory.setInventorySettings(req.body, req.user, requestMeta(req)) });
}
