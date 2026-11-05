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
import { requireAccess } from "../middlewares/requireAccess.js";
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

// Editing takes "edit" on Categories & Colours, read from the caller's role.
const mayEdit = requireAccess("categories:edit");

// Declared before `/:id` so neither can be read as a category with that id.
router.post("/reset", authenticate, requireBoundary, mayEdit, resetCategories);
router.put("/order", authenticate, requireBoundary, mayEdit, validate(reorderCategoriesSchema), reorderCategories);

router.get("/:id", authenticate, requireBoundary, getCategory);
router.post("/", authenticate, requireBoundary, mayEdit, validate(createCategorySchema), createCategory);
router.patch("/:id", authenticate, requireBoundary, mayEdit, validate(updateCategorySchema), updateCategory);
router.delete("/:id", authenticate, requireBoundary, mayEdit, deleteCategory);

export default router;
