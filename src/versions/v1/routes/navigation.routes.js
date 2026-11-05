/* Navigation Routes */

import { Router } from "express";
import { ApiError } from "../../../core/ApiError.js";
import { getNavigation, resetNavigation, updateNavigation } from "../controllers/navigation.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";
import { updateNavigationSchema } from "../schemas/navigation.schema.js";

/**
 * The mega menu, as the dashboard edits it. `PUT` replaces the whole tree —
 * the menu is one ordered structure — and must name the version it was edited
 * from. `POST /reset` restores the shipped menu.
 */

const router = Router();

/**
 * Synchronous validator, so a throw is caught by Express — see `sizes.routes.js`.
 *
 * Answers with the first problem as the message rather than the generic
 * "Validation failed.": the dashboard shows it in a toast, and "Two links use
 * the address /dresses/party" is something an editor can act on.
 */
function validateUpdate(req, res, next) {
  const result = updateNavigationSchema.safeParse(req.body);
  if (!result.success) {
    const [first] = result.error.issues;
    throw new ApiError(first?.message ?? "The menu could not be saved.", 400, {
      details: { path: first?.path.join(".") },
    });
  }
  req.body = result.data;
  next();
}

const mayEdit = requireAccess("mega-menu:edit");

router.get("/", authenticate, requireBoundary, getNavigation);
router.put("/", authenticate, requireBoundary, mayEdit, validateUpdate, updateNavigation);
router.post("/reset", authenticate, requireBoundary, mayEdit, resetNavigation);

export default router;
