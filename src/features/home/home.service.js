/* Home Page Tiles Service */

import crypto from "node:crypto";
import tilesSeed from "./seed.json" with { type: "json" };
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { getNavigation } from "../navigation/navigation.service.js";

/**
 * The photo tiles under "Explore the Collection" on the home page: a photo, a
 * name, a tagline and the menu page it opens. Read whole and saved whole, as
 * one ordered list, like the mega menu.
 *
 * Kept in the `settings` collection as the "home" document. Its `updatedAt` is
 * the version a save must name, so two people editing at once cannot silently
 * overwrite each other (409).
 *
 * A tile links to a page in the mega menu, because the menu is what decides
 * which addresses exist. A save naming any other address is refused; a tile
 * whose page was later taken out of the menu is left out of the shop rather
 * than shown as a link to a 404, and the dashboard says so.
 */

const ID = "home";
export const SEED_TILES = tilesSeed;
export const MAX_TILES = 6;

async function current() {
  const found = await prisma.setting.findUnique({ where: { id: ID } });
  if (found) return found;
  // Upsert rather than create: two first reads racing must not both fail.
  return prisma.setting.upsert({ where: { id: ID }, create: { id: ID, value: { tiles: SEED_TILES } }, update: {} });
}

/** Every address a tile may open: each menu item, and each link in its columns. */
export async function menuPages() {
  const { items } = await getNavigation();
  const pages = new Map();
  for (const root of items) {
    if (root.url) pages.set(root.url, root.label);
    for (const section of root.sections ?? []) {
      for (const leaf of section.items ?? []) if (leaf.url) pages.set(leaf.url, leaf.label);
    }
  }
  return pages;
}

function present(row, pages) {
  const tiles = (row.value?.tiles ?? []).map((tile) => ({ ...tile, linked: pages.has(tile.url) }));
  return { tiles, version: row.updatedAt.toISOString() };
}

/** For the shop: only tiles that still open a real page. */
export async function getHomeTiles() {
  const [row, pages] = await Promise.all([current(), menuPages()]);
  return present(row, pages).tiles.filter((t) => t.linked).map(({ linked: _linked, ...tile }) => tile);
}

/** For the dashboard: every tile, `linked: false` on any whose page has left the menu, and the version. */
export async function getHomeTilesForEditing() {
  const [row, pages] = await Promise.all([current(), menuPages()]);
  return present(row, pages);
}

export async function updateHomeTiles({ tiles, version }, actor, meta = {}) {
  const pages = await menuPages();
  const missing = tiles.find((t) => !pages.has(t.url));
  if (missing) {
    throw new ApiError(`“${missing.name}” links to ${missing.url}, which is not in the mega menu. Choose its link again.`, 422);
  }

  const seen = new Set();
  const clean = tiles.map(({ id, name, tagline = "", image, url }) => {
    let tileId = id && !seen.has(id) ? id : null;
    if (!tileId) tileId = `tile-${crypto.randomUUID().slice(0, 8)}`;
    seen.add(tileId);
    return { id: tileId, name, tagline, image, url };
  });

  await current();
  // Conditional update: only lands if nobody saved in between, even under a race.
  const { count } = await prisma.setting.updateMany({
    where: { id: ID, updatedAt: new Date(version) },
    data: { value: { tiles: clean } },
  });
  if (!count) {
    throw new ApiError("Someone else saved the home page tiles while you were editing. Reload to see their changes, then make yours again.", 409);
  }

  const row = await prisma.setting.findUnique({ where: { id: ID } });
  await audit(actor.id, "staff", "HOME_TILES_UPDATE", { ...meta, meta: { tiles: clean.length } });
  return present(row, pages);
}
