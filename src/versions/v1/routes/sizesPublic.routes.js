/* Size List Public Routes */

import { Router } from "express";
import { listPublicSizes } from "../controllers/sizes.controller.js";

/**
 * The size list as a shopper's filter reads it.
 *
 * Separate from the staff router on purpose, and for the same reason
 * `sizeGuidesPublic.routes.js` is a file of its own: this is public content
 * reached without an account, and a shopper filtering a category page has no
 * token and never will. Mounting the staff router here would put `authenticate`
 * in front of it and 401 every visitor — and, worse, make it one careless
 * `router.post` away from exposing a write.
 */

const router = Router();

router.get("/", listPublicSizes);

export default router;
