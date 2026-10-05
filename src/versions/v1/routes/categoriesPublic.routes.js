/* Category Public Routes */

import { Router } from "express";
import { listPublicCategories } from "../controllers/categories.controller.js";

/**
 * Categories as a shopper reads them — filters, menu, breadcrumbs. Its own
 * file for the same reason as `sizesPublic.routes.js`: no `authenticate`, and
 * no write one careless line away.
 */

const router = Router();

router.get("/", listPublicCategories);

export default router;
