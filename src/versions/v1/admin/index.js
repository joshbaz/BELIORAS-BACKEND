/* Admin Boundary Router */

import { Router } from "express";
import { setBoundary } from "../middlewares/boundary.js";
import authRoutes from "../routes/auth.routes.js";
import sizeGuideRoutes from "../routes/sizeGuides.routes.js";
import sizeRoutes from "../routes/sizes.routes.js";
import colorRoutes from "../routes/colors.routes.js";
import navigationRoutes from "../routes/navigation.routes.js";
import { listCustomers } from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";
import { adminReviews } from "../routes/reviews.routes.js";
import { adminMarketing } from "../routes/marketing.routes.js";
import activityRoutes from "../routes/activity.routes.js";
import roleRoutes from "../routes/roles.routes.js";
import orderRoutes from "../routes/orders.routes.js";
import salesRoutes from "../routes/sales.routes.js";
import uploadRoutes from "../routes/uploads.routes.js";
import productRoutes from "../routes/products.routes.js";
import inventoryRoutes from "../routes/inventory.routes.js";
import categoryRoutes from "../routes/categories.routes.js";

const router = Router();

// Inject 'staff' boundary for all routes in this namespace.
router.use(setBoundary("staff"));

// Mount shared auth routes under this boundary
router.use("/auth", authRoutes);

// Staff read and write. The guides are content, so `authenticate` and
// `requireBoundary` are redundant here — but they are what make the write
// safe, since `requireAccess` alone would read a customer token's role.
router.use("/size-guides", sizeGuideRoutes);

// The size list, same reasoning. Both resources sit behind the same section
// gate deliberately: a person who can add a size to the list can add the row
// that explains it to the guide, and splitting those across two permissions
// would only produce the half-finished state the Sizes page is trying to avoid.
router.use("/taxonomy/sizes", sizeRoutes);

// Categories, same reasoning and the same section gate.
router.use("/taxonomy/categories", categoryRoutes);

// Colours, same section gate as categories (both are Categories & Colours).
router.use("/taxonomy/colors", colorRoutes);

// The mega menu, same section gate as the rest of the catalogue content.
router.use("/navigation", navigationRoutes);

// The catalogue and its stock. Product writes take the Products roles; stock
// takes Inventory's, with order-driven moves open to whoever handles orders.
router.use("/products", productRoutes);
router.use("/inventory", inventoryRoutes);

// Photos and videos for products, menu tiles and fit models.
router.use("/uploads", uploadRoutes);

// Orders, and what moves with them: coupons, transactions, the email outbox
// and the store settings that price an order and print its invoice.
router.use("/orders", orderRoutes);
router.use(salesRoutes);
router.use(adminReviews);
router.use(adminMarketing);

// Team → Roles: what each role may do, read by every request's access check.
router.use(roleRoutes);

// The Activity page, from the server's audit log.
router.use(activityRoutes);

// Shoppers with an account, for the Customers page (read-only).
router.get("/customers", authenticate, requireBoundary, requireAccess("customers:view"), listCustomers);

// TODO: Mount sales report routes here

export default router;
