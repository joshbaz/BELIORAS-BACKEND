/* Inventory Routes */

import { Router } from "express";
import { validateWithReason } from "../../../middlewares/validate.js";
import {
  adjustStock,
  getInventorySettings,
  receiveStock,
  setInventorySettings,
  stockHistory,
} from "../controllers/inventory.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";
import {
  adjustStockSchema,
  inventorySettingsSchema,
  receiveStockSchema,
} from "../schemas/inventory.schema.js";

/**
 * Stock by hand: adjusting, receiving and the low-stock line, for the roles
 * the dashboard grants "edit" on Inventory (staff, super-admin). Shipping and
 * returns move stock too, but inside the order flows (`/orders`), so whoever
 * handles orders never needs this edge.
 */

const router = Router();

const validate = (schema) => validateWithReason(schema);

const mayEditStock = requireAccess("inventory:edit");

router.get("/movements", authenticate, requireBoundary, stockHistory);
router.get("/settings", authenticate, requireBoundary, getInventorySettings);
router.put("/settings", authenticate, requireBoundary, mayEditStock, validate(inventorySettingsSchema), setInventorySettings);
router.post("/adjust", authenticate, requireBoundary, mayEditStock, validate(adjustStockSchema), adjustStock);
router.post("/receive", authenticate, requireBoundary, mayEditStock, validate(receiveStockSchema), receiveStock);

export default router;
