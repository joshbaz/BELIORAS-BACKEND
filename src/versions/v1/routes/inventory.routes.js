/* Inventory Routes */

import { Router } from "express";
import {
  adjustStock,
  getInventorySettings,
  orderMovements,
  receiveStock,
  setInventorySettings,
  stockHistory,
} from "../controllers/inventory.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireRole } from "../middlewares/requireRole.js";
import {
  adjustStockSchema,
  inventorySettingsSchema,
  orderMovementsSchema,
  receiveStockSchema,
} from "../schemas/inventory.schema.js";

/**
 * Stock. Two gates, because two different jobs move it:
 *
 *   - adjusting, receiving and the low-stock line are Inventory's (staff,
 *     super-admin), the roles the dashboard grants "edit" on Inventory;
 *   - shipping and returns take stock off and put it back as part of handling
 *     an order, which Customer support may do without being able to edit
 *     stock by hand — so that edge only accepts "sold"/"returned" with an order.
 */

const router = Router();

const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};

const mayEditStock = requireRole("staff", "super-admin");
const mayHandleOrders = requireRole("support", "staff", "super-admin");

router.get("/movements", authenticate, requireBoundary, stockHistory);
router.get("/settings", authenticate, requireBoundary, getInventorySettings);
router.put("/settings", authenticate, requireBoundary, mayEditStock, validate(inventorySettingsSchema), setInventorySettings);
router.post("/adjust", authenticate, requireBoundary, mayEditStock, validate(adjustStockSchema), adjustStock);
router.post("/receive", authenticate, requireBoundary, mayEditStock, validate(receiveStockSchema), receiveStock);
router.post("/order-movements", authenticate, requireBoundary, mayHandleOrders, validate(orderMovementsSchema), orderMovements);

export default router;
