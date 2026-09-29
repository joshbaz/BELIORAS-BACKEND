/* Size Guides Public Routes */

import { Router } from "express";
import { listPublicGuides } from "../controllers/sizeGuides.controller.js";

/**
 * The size guides as a shopper reads them.
 *
 * Separate from the staff router on purpose. The guides are public content, and
 * a shopper opening /shoe-size-guide has no account and never will — mounting
 * the staff router here would put `authenticate` in front of it and 401 every
 * visitor. Keeping the two files apart also means a write can never be added to
 * the public surface by accident: this file is a read, and nothing else.
 */

const router = Router();

router.get("/", listPublicGuides);

export default router;
