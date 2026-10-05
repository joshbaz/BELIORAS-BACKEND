/* Navigation Public Routes */

import { Router } from "express";
import { getPublicNavigation } from "../controllers/navigation.controller.js";

/** The menu as every shopper's header and footer read it — no account, no writes. */

const router = Router();

router.get("/", getPublicNavigation);

export default router;
