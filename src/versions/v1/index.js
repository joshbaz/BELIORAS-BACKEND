/* V1 Router */

import { Router } from "express";
import healthRoutes from "./routes/health.routes.js";
import storefrontRouter from "./storefront/index.js";
import adminRouter from "./admin/index.js";

const router = Router();

router.use("/health", healthRoutes);

// Service Boundaries
router.use("/storefront", storefrontRouter);
router.use("/admin", adminRouter);

export default router;