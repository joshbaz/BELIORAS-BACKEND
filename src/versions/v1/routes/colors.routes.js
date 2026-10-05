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
import { requireRole } from "../middlewares/requireRole.js";
import { createColorSchema, updateColorSchema } from "../schemas/colors.schema.js";

/** The colour list, as the dashboard edits it. Same shape as `categories.routes.js`. */

const router = Router();

/** Synchronous validators, so a zod throw is caught by Express — see `sizes.routes.js`. */
const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};

router.get("/", authenticate, requireBoundary, listColors);

const mayEdit = requireRole("content", "staff", "super-admin");

// Declared before `/:id` so it cannot be read as a colour called "reset".
router.post("/reset", authenticate, requireBoundary, mayEdit, resetColors);

router.get("/:id", authenticate, requireBoundary, getColor);
router.post("/", authenticate, requireBoundary, mayEdit, validate(createColorSchema), createColor);
router.patch("/:id", authenticate, requireBoundary, mayEdit, validate(updateColorSchema), updateColor);
router.delete("/:id", authenticate, requireBoundary, mayEdit, deleteColor);

export default router;
