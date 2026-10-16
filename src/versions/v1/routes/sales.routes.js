/* Sales Routes (dashboard): coupons, transactions, the email outbox, store settings */

import { Router } from "express";
import { validateWithReason as validate } from "../../../middlewares/validate.js";
import {
  couponStats,
  createCoupon,
  deleteCoupon,
  getSettings,
  listCoupons,
  listEmailsHandler,
  listTransactionsHandler,
  updateCoupon,
  updateSettings,
} from "../controllers/sales.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireRole } from "../middlewares/requireRole.js";
import { couponPatchSchema, couponSchema, settingsPatchSchema } from "../schemas/orders.schema.js";

/**
 * Gates follow the dashboard's sections: Discounts (staff edit, finance view),
 * Transactions (finance, plus whoever handles orders, since an order's page
 * shows its payments), the email outbox (any staff — an order's page shows
 * what was sent), and Settings (administrators only).
 */

const router = Router();
const staffIn = [authenticate, requireBoundary];

router.get("/coupons", ...staffIn, requireRole("staff", "finance", "super-admin"), listCoupons);
router.get("/coupons/stats", ...staffIn, requireRole("staff", "finance", "super-admin"), couponStats);
router.post("/coupons", ...staffIn, requireRole("staff", "super-admin"), validate(couponSchema), createCoupon);
router.patch("/coupons/:id", ...staffIn, requireRole("staff", "super-admin"), validate(couponPatchSchema), updateCoupon);
router.delete("/coupons/:id", ...staffIn, requireRole("staff", "super-admin"), deleteCoupon);

router.get("/transactions", ...staffIn, requireRole("finance", "support", "staff", "super-admin"), listTransactionsHandler);
router.get("/emails", ...staffIn, listEmailsHandler);

router.get("/settings", ...staffIn, getSettings);
router.patch("/settings", ...staffIn, requireRole("super-admin"), validate(settingsPatchSchema), updateSettings);

export default router;
