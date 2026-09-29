/* Size Guides Controller */

import * as sizeGuides from "../../../features/sizeGuides/sizeGuides.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/**
 * Reading and writing the three size guides.
 *
 * The public read and the admin read return the same shape, so the storefront
 * and the dashboard cannot end up interpreting a guide differently. Nothing here
 * contains business logic — that is the service's job.
 */

export async function listGuides(req, res) {
  res.json({ data: await sizeGuides.listGuides() });
}

/**
 * The storefront's read.
 *
 * Cached briefly, since every size page on the site asks for this and the
 * content changes a few times a year. Short enough that a guide edited in the
 * dashboard is live on the shop within a minute.
 */
export async function listPublicGuides(req, res) {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ data: await sizeGuides.listGuides() });
}

export async function getGuide(req, res) {
  const guide = await sizeGuides.getGuide(req.params.type);
  if (!guide) return res.status(404).json({ error: { code: "NOT_FOUND", message: "That size guide has not been saved yet." } });
  res.json({ data: guide });
}

/** Replaces one guide whole. The body was already matched to `:type` by the route. */
export async function saveGuide(req, res) {
  const guide = await sizeGuides.saveGuide(req.params.type, req.body, req.user, requestMeta(req));
  res.json({ data: guide });
}

/** Puts every guide back to the shipped version. */
export async function resetGuides(req, res) {
  const guides = await sizeGuides.resetGuides(req.user, requestMeta(req));
  res.json({ data: guides });
}
