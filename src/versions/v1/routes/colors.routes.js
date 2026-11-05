/* Colour Routes */

import { Router } from "express";
import {
  createColor,
  deleteColor,
  getColor,
  listColors,
  resetColors,
  updateColor,
} from "../controllers/colors.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";
import { createColorSchema, updateColorSchema } from "../schemas/colors.schema.js";
import { z } from "zod";
import { getFamilies, updateFamilies } from "../../../features/colors/families.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/** The colour list, as the dashboard edits it. Same shape as `categories.routes.js`. */

const router = Router();

/** Synchronous validators, so a zod throw is caught by Express — see `sizes.routes.js`. */
const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};

router.get("/", authenticate, requireBoundary, listColors);

const mayEdit = requireAccess("categories:edit");

// The shop-filter families every colour belongs to. Declared before `/:id`.
const familiesSchema = z
  .object({
    label: z.record(z.string().max(5), z.string().max(40)).optional(),
    values: z
      .array(z.object({ id: z.string().trim().regex(/^[a-z0-9-]+$/).max(40), name: z.string().trim().min(1).max(40), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict())
      .min(1)
      .max(40),
  })
  .strict();
router.get("/families", authenticate, requireBoundary, async (req, res) => res.json({ data: await getFamilies() }));
router.put("/families", authenticate, requireBoundary, mayEdit, validate(familiesSchema), async (req, res) => {
  res.json({ data: await updateFamilies(req.body, req.user, requestMeta(req)) });
});

// Declared before `/:id` so it cannot be read as a colour called "reset".
router.post("/reset", authenticate, requireBoundary, mayEdit, resetColors);

router.get("/:id", authenticate, requireBoundary, getColor);
router.post("/", authenticate, requireBoundary, mayEdit, validate(createColorSchema), createColor);
router.patch("/:id", authenticate, requireBoundary, mayEdit, validate(updateColorSchema), updateColor);
router.delete("/:id", authenticate, requireBoundary, mayEdit, deleteColor);

export default router;
