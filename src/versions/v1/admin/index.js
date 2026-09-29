/* Admin Boundary Router */

import { Router } from "express";
import { setBoundary } from "../middlewares/boundary.js";
import authRoutes from "../routes/auth.routes.js";
import sizeGuideRoutes from "../routes/sizeGuides.routes.js";

const router = Router();

// Inject 'staff' boundary for all routes in this namespace.
router.use(setBoundary("staff"));

// Mount shared auth routes under this boundary
router.use("/auth", authRoutes);

// Staff read and write. The guides are content, so `authenticate` and
// `requireBoundary` are redundant here — but they are what make the write
// safe, since `requireRole` alone would read a customer token's role and let it
// through.
router.use("/size-guides", sizeGuideRoutes);

// TODO: Mount inventory, global orders, sales report routes here

export default router;
