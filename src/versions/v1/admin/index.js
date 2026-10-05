/* Admin Boundary Router */

import { Router } from "express";
import { setBoundary } from "../middlewares/boundary.js";
import authRoutes from "../routes/auth.routes.js";
import sizeGuideRoutes from "../routes/sizeGuides.routes.js";
import sizeRoutes from "../routes/sizes.routes.js";
import categoryRoutes from "../routes/categories.routes.js";

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

// The size list, same reasoning. Both resources sit behind the same section
// gate deliberately: a person who can add a size to the list can add the row
// that explains it to the guide, and splitting those across two permissions
// would only produce the half-finished state the Sizes page is trying to avoid.
router.use("/taxonomy/sizes", sizeRoutes);

// Categories, same reasoning and the same section gate.
router.use("/taxonomy/categories", categoryRoutes);

// TODO: Mount inventory, global orders, sales report routes here

export default router;
