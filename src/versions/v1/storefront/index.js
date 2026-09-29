/* Storefront Boundary Router */

import { Router } from "express";
import { setBoundary } from "../middlewares/boundary.js";
import authRoutes from "../routes/auth.routes.js";
import sizeGuideRoutes from "../routes/sizeGuidesPublic.routes.js";

const router = Router();

// Inject 'customer' boundary for all routes in this namespace.
router.use(setBoundary("customer"));

// Mount shared auth routes under this boundary
router.use("/auth", authRoutes);

// Size guides are public content a shopper reads without an account, so this is
// the one resource here with no `authenticate` in front of it.
router.use("/size-guides", sizeGuideRoutes);

// TODO: Mount products, orders, profile routes here

export default router;
