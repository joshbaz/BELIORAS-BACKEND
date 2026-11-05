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
import { requireAccess } from "../middlewares/requireAccess.js";
import { couponPatchSchema, couponSchema, settingsPatchSchema } from "../schemas/orders.schema.js";

/**
 * Gates follow the dashboard's sections: Discounts, Transactions (or Orders,
 * since an order's page shows its payments), the email outbox (any staff — an
 * order's page shows what was sent), and Settings or Shipping.
 */

const router = Router();

/** Saving only the shipping section is Shipping's to do; anything else is Settings'. */
const maySaveSettings = (req, res, next) => {
  const keys = Object.keys(req.body ?? {});
  const section = keys.length && keys.every((k) => k === "shipping") ? "shipping" : "settings";
  return requireAccess(`${section}:edit`)(req, res, next);
};
const staffIn = [authenticate, requireBoundary];

router.get("/coupons", ...staffIn, requireAccess("discounts:view"), listCoupons);
router.get("/coupons/stats", ...staffIn, requireAccess("discounts:view"), couponStats);
router.post("/coupons", ...staffIn, requireAccess("discounts:edit"), validate(couponSchema), createCoupon);
router.patch("/coupons/:id", ...staffIn, requireAccess("discounts:edit"), validate(couponPatchSchema), updateCoupon);
router.delete("/coupons/:id", ...staffIn, requireAccess("discounts:edit"), deleteCoupon);

router.get("/transactions", ...staffIn, requireAccess("transactions:view", "orders:view"), listTransactionsHandler);
router.get("/emails", ...staffIn, listEmailsHandler);

router.get("/settings", ...staffIn, getSettings);
router.patch("/settings", ...staffIn, maySaveSettings, validate(settingsPatchSchema), updateSettings);

export default router;
