/* Category Controller */

import * as categories from "../../../features/categories/categories.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/**
 * Reading and writing categories. The public and staff reads return the same
 * shape, so the storefront and the dashboard cannot read a category differently.
 * No business logic here — that is the service's job.
 */

export async function listCategories(req, res) {
  res.json({ data: await categories.listCategories() });
}

/** The storefront's read: filters, the menu, breadcrumbs and search all hang off it. */
export async function listPublicCategories(req, res) {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ data: await categories.listCategories() });
}

export async function getCategory(req, res) {
  const category = await categories.getCategory(req.params.id);
  if (!category) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "That category does not exist." } });
  }
  res.json({ data: category });
}

export async function createCategory(req, res) {
  res.status(201).json({ data: await categories.createCategory(req.body, req.user, requestMeta(req)) });
}

export async function updateCategory(req, res) {
  res.json({ data: await categories.updateCategory(req.params.id, req.body, req.user, requestMeta(req)) });
}

export async function deleteCategory(req, res) {
  res.json({ data: await categories.deleteCategory(req.params.id, req.user, requestMeta(req)) });
}

export async function reorderCategories(req, res) {
  res.json({ data: await categories.reorderCategories(req.body, req.user, requestMeta(req)) });
}

export async function resetCategories(req, res) {
  res.json({ data: await categories.resetCategories(req.user, requestMeta(req)) });
}
