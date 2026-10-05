/* Colour Public Routes */

import { Router } from "express";
import { listPublicColors } from "../controllers/colors.controller.js";

/** The colour list as a shopper's swatches and filters read it — no account, no writes. */

const router = Router();

router.get("/", listPublicColors);

export default router;
