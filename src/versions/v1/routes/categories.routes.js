/* Category Routes */

import { Router } from "express";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  reorderCategories,
  resetCategories,
  updateCategory,
} from "../controllers/categories.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireRole } from "../middlewares/requireRole.js";
import {
  createCategorySchema,
  reorderCategoriesSchema,
  updateCategorySchema,
} from "../schemas/categories.schema.js";

/**
 * Categories, as the dashboard edits them.
 *
 * Same shape as the size list, plus `PUT /order`: order is a property of the
 * whole list rather than of one category, so it gets its own edge instead of
 * riding on a `PATCH` that would then have to accept a `position`.
 */

const router = Router();

/** Synchronous validators, so a zod throw is caught by Express — see `sizes.routes.js`. */
const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};

router.get("/", authenticate, requireBoundary, listCategories);

// Same roles as the size list: the ones the dashboard grants edit on catalogue
// content. `requireRole` takes roles as separate arguments.
const mayEdit = requireRole("content", "staff", "super-admin");

// Declared before `/:id` so neither can be read as a category with that id.
router.post("/reset", authenticate, requireBoundary, mayEdit, resetCategories);
router.put("/order", authenticate, requireBoundary, mayEdit, validate(reorderCategoriesSchema), reorderCategories);

router.get("/:id", authenticate, requireBoundary, getCategory);
router.post("/", authenticate, requireBoundary, mayEdit, validate(createCategorySchema), createCategory);
router.patch("/:id", authenticate, requireBoundary, mayEdit, validate(updateCategorySchema), updateCategory);
router.delete("/:id", authenticate, requireBoundary, mayEdit, deleteCategory);

export default router;
