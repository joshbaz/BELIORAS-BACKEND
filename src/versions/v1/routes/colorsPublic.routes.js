/* Colour Public Routes */

import { Router } from "express";
import { listPublicColors } from "../controllers/colors.controller.js";
import { getFamilies } from "../../../features/colors/families.service.js";

/** The colour list as a shopper's swatches and filters read it — no account, no writes. */

const router = Router();

router.get("/", listPublicColors);
// The filter families colours belong to — what `?color=black` resolves against.
router.get("/families", async (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ data: await getFamilies() });
});

export default router;
