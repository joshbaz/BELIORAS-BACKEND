/* Product Routes */

import { Router } from "express";
import { validateWithReason } from "../../../middlewares/validate.js";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  restoreProduct,
  updateProduct,
} from "../controllers/products.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";
import { createProductSchema, updateProductSchema } from "../schemas/products.schema.js";

/**
 * The catalogue, as the dashboard edits it. `DELETE` hides a piece and keeps
 * its row; `POST /:id/restore` is the dashboard's Undo.
 */

const router = Router();

const validate = (schema) => validateWithReason(schema);

// The roles the dashboard grants "edit" on Products.
const mayEdit = requireAccess("products:edit");

router.get("/", authenticate, requireBoundary, listProducts);
router.get("/:id", authenticate, requireBoundary, getProduct);
router.post("/", authenticate, requireBoundary, mayEdit, validate(createProductSchema), createProduct);
router.patch("/:id", authenticate, requireBoundary, mayEdit, validate(updateProductSchema), updateProduct);
router.delete("/:id", authenticate, requireBoundary, mayEdit, deleteProduct);
router.post("/:id/restore", authenticate, requireBoundary, mayEdit, restoreProduct);

export default router;
