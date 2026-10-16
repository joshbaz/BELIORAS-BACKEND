/* Product Public Routes */

import { Router } from "express";
import { getPublicProduct, listPublicProducts } from "../controllers/products.controller.js";

/** The catalogue as a shopper reads it: active pieces, no cost price, no writes. `:id` takes an id or a slug. */

const router = Router();

router.get("/", listPublicProducts);
router.get("/:id", getPublicProduct);

export default router;
