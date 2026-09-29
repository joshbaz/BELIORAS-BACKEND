/* Size Guides Routes */

import { Router } from "express";
import {
  getGuide,
  listGuides,
  resetGuides,
  saveGuide,
} from "../controllers/sizeGuides.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireRole } from "../middlewares/requireRole.js";
import { GUIDE_BODY_SCHEMAS, GUIDE_TYPES } from "../schemas/sizeGuides.schema.js";
import { ApiError } from "../../../core/ApiError.js";

const router = Router();

/** The `:type` in the path is one of the three. Checked before anything reads the body. */
function requireKnownType(req, res, next) {
  if (!GUIDE_TYPES.includes(req.params.type)) {
    return next(new ApiError("That size guide does not exist.", 404));
  }
  next();
}

/**
 * Matches the body against the schema for the `:type` in the path.
 *
 * `validate(schema)` picks its schema when the router is built, which is before
 * a request has a `:type`. This is the same job, decided per request — so a hair
 * guide posted to `/garment` is refused instead of being stored under a name it
 * does not belong to.
 */
function validateGuideFor(req, res, next) {
  req.body = GUIDE_BODY_SCHEMAS[req.params.type].parse(req.body);
  next();
}

// Reading is open to any signed-in member of this boundary; the guides are
// public content and the storefront reads them with its own token.
router.get("/", authenticate, requireBoundary, listGuides);
router.get("/:type", authenticate, requireBoundary, requireKnownType, getGuide);

// Writing is the first section gate on this server. The capability matrix itself
// still lives in the client, so this is a coarse list of the roles the dashboard
// grants "edit" on Sizes & Guides — enough that a role without it cannot write
// even if the screen offers the button. Note the spread: `requireRole` takes
// roles as separate arguments, and an array here would match nothing and lock
// everyone out, administrators included.
const mayEditGuides = requireRole("content", "staff", "super-admin");

router.put("/:type", authenticate, requireBoundary, mayEditGuides, requireKnownType, validateGuideFor, saveGuide);
router.post("/reset", authenticate, requireBoundary, mayEditGuides, resetGuides);

export default router;
