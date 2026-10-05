/* Colour Controller */

import * as colors from "../../../features/colors/colors.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/** Reading and writing the colour list. Same shape for staff and storefront; no business logic here. */

export async function listColors(req, res) {
  res.json({ data: await colors.listColors() });
}

/** The storefront's read: every product's swatches and colour filters resolve through it. */
export async function listPublicColors(req, res) {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ data: await colors.listColors() });
}

export async function getColor(req, res) {
  const color = await colors.getColor(req.params.id);
  if (!color) return res.status(404).json({ error: { code: "NOT_FOUND", message: "That colour does not exist." } });
  res.json({ data: color });
}

export async function createColor(req, res) {
  res.status(201).json({ data: await colors.createColor(req.body, req.user, requestMeta(req)) });
}

export async function updateColor(req, res) {
  res.json({ data: await colors.updateColor(req.params.id, req.body, req.user, requestMeta(req)) });
}

export async function deleteColor(req, res) {
  res.json({ data: await colors.deleteColor(req.params.id, req.user, requestMeta(req)) });
}

export async function resetColors(req, res) {
  res.json({ data: await colors.resetColors(req.user, requestMeta(req)) });
}
