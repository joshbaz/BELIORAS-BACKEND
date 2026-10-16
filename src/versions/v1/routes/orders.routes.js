/* Order Routes (dashboard) */

import { Router } from "express";
import { validateWithReason as validate } from "../../../middlewares/validate.js";
import {
  cancelOrder,
  getInvoice,
  getOrder,
  listOrders,
  refundOrder,
  resendConfirmation,
  updateStatus,
} from "../controllers/orders.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireRole } from "../middlewares/requireRole.js";
import { cancelSchema, refundSchema, statusSchema } from "../schemas/orders.schema.js";

/**
 * Orders, as the dashboard handles them. Reading is open to the roles that see
 * orders or customers (finance reads for its figures); changing an order —
 * shipping, cancelling, refunding — to those the dashboard grants "edit" on
 * Orders. Payment is never set by hand: only the payment step marks an order paid.
 */

const router = Router();

const mayRead = requireRole("support", "staff", "finance", "super-admin");
const mayHandle = requireRole("support", "staff", "super-admin");

router.get("/", authenticate, requireBoundary, mayRead, listOrders);
router.get("/:id", authenticate, requireBoundary, mayRead, getOrder);
router.get("/:id/invoice", authenticate, requireBoundary, mayRead, getInvoice);
router.post("/:id/status", authenticate, requireBoundary, mayHandle, validate(statusSchema), updateStatus);
router.post("/:id/cancel", authenticate, requireBoundary, mayHandle, validate(cancelSchema), cancelOrder);
router.post("/:id/refund", authenticate, requireBoundary, mayHandle, validate(refundSchema), refundOrder);
router.post("/:id/resend-confirmation", authenticate, requireBoundary, mayHandle, resendConfirmation);

export default router;
