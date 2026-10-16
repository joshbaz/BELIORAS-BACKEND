/* Order Routes (storefront) */

import { Router } from "express";
import { validateWithReason as validate } from "../../../middlewares/validate.js";
import {
  bestSellers,
  cancelMyOrder,
  checkout,
  getInvoice,
  getOrder,
  listMyOrders,
  paymentConfig,
  simulatePayment,
} from "../controllers/orders.controller.js";
import { validateCoupon } from "../controllers/sales.controller.js";
import { authenticate, optionalAuthenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { cancelSchema, checkoutSchema, simulatePaymentSchema, validateCouponSchema } from "../schemas/orders.schema.js";

/**
 * What a shopper does with orders. Guests may check out and follow an order
 * with its email; a signed-in customer's own orders need no email. Every
 * order read checks ownership, and a wrong guess looks the same as a missing
 * order.
 */

const router = Router();

router.post("/checkout", optionalAuthenticate, validate(checkoutSchema), checkout);
router.get("/checkout/payment-config", paymentConfig);
router.post("/checkout/:id/simulate-payment", optionalAuthenticate, validate(simulatePaymentSchema), simulatePayment);
router.post("/coupons/validate", optionalAuthenticate, validate(validateCouponSchema), validateCoupon);
router.get("/rankings/best-sellers", bestSellers);

router.get("/orders", authenticate, requireBoundary, listMyOrders);
router.get("/orders/:id", optionalAuthenticate, getOrder);
router.get("/orders/:id/invoice", optionalAuthenticate, getInvoice);
router.post("/orders/:id/cancel", optionalAuthenticate, validate(cancelSchema), cancelMyOrder);

export default router;
