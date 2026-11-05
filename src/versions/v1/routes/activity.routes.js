/* Activity Routes */

import { Router } from "express";
import { lastSignIns, listActivity } from "../../../features/activity/activity.service.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";

/** The Activity page (Activity: view), and last sign-ins for the Team roster (Team: view). */
const router = Router();

router.get("/activity", authenticate, requireBoundary, requireAccess("activity:view"), async (req, res) => {
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 2000));
  res.json({ data: await listActivity({ limit }) });
});

router.get("/activity/sign-ins", authenticate, requireBoundary, requireAccess("team:view", "activity:view"), async (req, res) => {
  res.json({ data: await lastSignIns() });
});

export default router;
