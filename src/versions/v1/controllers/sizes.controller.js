/* Size List Controller */

import * as sizes from "../../../features/sizes/sizes.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/**
 * Reading and writing the size list.
 *
 * The public read and the staff read return the same shape, so the storefront
 * facet and the dashboard cannot end up interpreting a list differently. No
 * business logic here — that is the service's job.
 */

export async function listSizes(req, res) {
  res.json({ data: await sizes.listSizes() });
}

/**
 * The storefront's read.
 *
 * Cached, and for longer than the guides get: the size list changes when the
 * shop adds a size, which is a few times a year, whereas the guides are edited
 * while a range is being worked out. A shopper's filter chips and every cart and
 * packing slip in the shop depend on this resolving to the same list.
 */
export async function listPublicSizes(req, res) {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ data: await sizes.listSizes() });
}

export async function getSize(req, res) {
  const size = await sizes.getSize(req.params.id);
  if (!size) return res.status(404).json({ error: { code: "NOT_FOUND", message: "That size does not exist." } });
  res.json({ data: size });
}

/** Adds a size at the end of the list. The body was already validated by the route. */
export async function createSize(req, res) {
  res.status(201).json({ data: await sizes.createSize(req.body, req.user, requestMeta(req)) });
}

/** Changes the display name. The id is in the path and is not editable. */
export async function renameSize(req, res) {
  res.json({ data: await sizes.renameSize(req.params.id, req.body, req.user, requestMeta(req)) });
}

/** Removes a size and spends its id. See the service for why deletion is only partly guarded. */
export async function deleteSize(req, res) {
  res.json({ data: await sizes.deleteSize(req.params.id, req.user, requestMeta(req)) });
}

/** Puts the list back to the shipped twelve. */
export async function resetSizes(req, res) {
  res.json({ data: await sizes.resetSizes(req.user, requestMeta(req)) });
}
