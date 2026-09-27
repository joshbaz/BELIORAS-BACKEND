/* Admin Boundary Router */

import { Router } from "express";
import { setBoundary } from "../middlewares/boundary.js";
import authRoutes from "../routes/auth.routes.js";

const router = Router();

// Inject 'staff' boundary for all routes in this namespace.
router.use(setBoundary("staff"));

// Mount shared auth routes under this boundary
router.use("/auth", authRoutes);

// TODO: Mount inventory, global orders, sales report routes here

export default router;
