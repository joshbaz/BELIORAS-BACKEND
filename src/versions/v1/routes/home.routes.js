/* Home Page Routes */

import { Router } from "express";
import { z } from "zod";
import { validateWithReason as validate } from "../../../middlewares/validate.js";
import * as home from "../../../features/home/home.service.js";
import { requestMeta } from "../../../features/audit/audit.js";
import { mediaUrl } from "../schemas/products.schema.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";

/** The home page's photo tiles: shoppers read them; "edit" on Home page changes them. */

const tileSchema = z
  .object({
    id: z.string().trim().max(60).optional(),
    name: z.string().trim().min(1, "Every tile needs a name.").max(60, "Keep tile names to 60 characters."),
    tagline: z.string().trim().max(80, "Keep taglines to 80 characters.").default(""),
    image: mediaUrl,
    url: z.string().trim().regex(/^\/(?!\/)/, "Choose which page the tile opens.").max(300),
    linked: z.boolean().optional(),
  })
  .strip();

const saveSchema = z
  .object({
    tiles: z.array(tileSchema).min(1, "Keep at least one tile.").max(home.MAX_TILES, `Up to ${home.MAX_TILES} tiles.`),
    version: z.string().datetime({ message: "Reload the page: the tiles you were editing have no version." }),
  })
  .strict();

export const publicHome = Router();
publicHome.get("/home/tiles", async (req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  res.json({ data: await home.getHomeTiles() });
});

export const adminHome = Router();
const staffIn = [authenticate, requireBoundary];

adminHome.get("/home/tiles", ...staffIn, async (req, res) => res.json({ data: await home.getHomeTilesForEditing() }));
adminHome.put("/home/tiles", ...staffIn, requireAccess("home:edit"), validate(saveSchema), async (req, res) => {
  res.json({ data: await home.updateHomeTiles(req.body, req.user, requestMeta(req)) });
});
