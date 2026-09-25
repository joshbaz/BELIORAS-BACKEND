/* V1 Router */

import { Router } from "express";
import authRoutes from "./routes/auth.routes.js";
import healthRoutes from "./routes/health.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);

export default router;