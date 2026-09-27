/* Storefront Boundary Router */

import { Router } from "express";
import { setBoundary } from "../middlewares/boundary.js";
import authRoutes from "../routes/auth.routes.js";

const router = Router();

// Inject 'customer' boundary for all routes in this namespace.
router.use(setBoundary("customer"));

// Mount shared auth routes under this boundary
router.use("/auth", authRoutes);

// TODO: Mount products, orders, profile routes here

export default router;
