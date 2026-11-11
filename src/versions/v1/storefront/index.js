/* Storefront Boundary Router */

import { Router } from "express";
import { setBoundary } from "../middlewares/boundary.js";
import authRoutes from "../routes/auth.routes.js";
import sizeGuideRoutes from "../routes/sizeGuidesPublic.routes.js";
import sizeRoutes from "../routes/sizesPublic.routes.js";
import colorRoutes from "../routes/colorsPublic.routes.js";
import navigationRoutes from "../routes/navigationPublic.routes.js";
import { publicReviews } from "../routes/reviews.routes.js";
import { publicMarketing } from "../routes/marketing.routes.js";
import { publicModels } from "../routes/models.routes.js";
import { publicHome } from "../routes/home.routes.js";
import orderRoutes from "../routes/ordersPublic.routes.js";
import { getSettings } from "../controllers/sales.controller.js";
import productRoutes from "../routes/productsPublic.routes.js";
import categoryRoutes from "../routes/categoriesPublic.routes.js";

const router = Router();

// Inject 'customer' boundary for all routes in this namespace.
router.use(setBoundary("customer"));

// Mount shared auth routes under this boundary
router.use("/auth", authRoutes);

// Size guides are public content a shopper reads without an account, so this is
// the one resource here with no `authenticate` in front of it.
router.use("/size-guides", sizeGuideRoutes);

// The size list, for the same reason and with the same caveat. Fifteen places in
// the client read it — the shop facet, the cart, the wardrobe, packing slips —
// and a shopper with a full basket has no account token to read it with. Note
// this is the *list*, not the guides: it is the thing `?size=eu38,m` resolves
// against, so a filter URL a shopper followed from a search result has to work
// without them being signed in.
router.use("/taxonomy/sizes", sizeRoutes);

// Categories: the shop filters, menu and breadcrumbs, read without an account.
router.use("/taxonomy/categories", categoryRoutes);

// Colours: every product's swatches and the colour filter, read without an account.
router.use("/taxonomy/colors", colorRoutes);

// The mega menu: every page's header and footer, read without an account.
router.use("/navigation", navigationRoutes);

// The catalogue as shoppers see it: active pieces only, no cost price.
router.use("/products", productRoutes);

// Checkout, a shopper's orders, coupon checks and best-seller rankings.
router.use(orderRoutes);
router.use(publicReviews);
router.use(publicMarketing);
router.use(publicModels);
router.use(publicHome);

// The store settings the storefront shows: shipping zones, VAT, contact, copy.
router.get("/settings", getSettings);

// TODO: Mount profile routes here

export default router;
