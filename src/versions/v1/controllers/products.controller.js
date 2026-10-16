/* Product Controller */

import * as products from "../../../features/products/products.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/** Reading and writing the catalogue. No business logic here — that is the service's job. */

const notFound = (res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Product not found." } });

/** Staff: every live piece, drafts included, with cost price. */
export async function listProducts(req, res) {
  res.json({ data: await products.listProducts({ audience: "staff" }) });
}

/** Storefront: active pieces only, never cost price. */
export async function listPublicProducts(req, res) {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ data: await products.listProducts({ audience: "public" }) });
}

export async function getProduct(req, res) {
  const product = await products.getProduct(req.params.id, { audience: "staff" });
  return product ? res.json({ data: product }) : notFound(res);
}

export async function getPublicProduct(req, res) {
  const product = await products.getProduct(req.params.id, { audience: "public" });
  return product ? res.json({ data: product }) : notFound(res);
}

export async function createProduct(req, res) {
  res.status(201).json({ data: await products.createProduct(req.body, req.user, requestMeta(req)) });
}

export async function updateProduct(req, res) {
  res.json({ data: await products.updateProduct(req.params.id, req.body, req.user, requestMeta(req)) });
}

export async function deleteProduct(req, res) {
  res.json({ data: await products.deleteProduct(req.params.id, req.user, requestMeta(req)) });
}

export async function restoreProduct(req, res) {
  res.json({ data: await products.restoreProduct(req.params.id, req.user, requestMeta(req)) });
}
