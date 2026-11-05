/* Size List Routes */

import { Router } from "express";
import {
  createSize,
  deleteSize,
  getSize,
  listSizes,
  renameSize,
  resetSizes,
} from "../controllers/sizes.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";
import { createSizeSchema, renameSizeSchema } from "../schemas/sizes.schema.js";

/**
 * The size list, as the dashboard edits it.
 *
 * Sized at three edges rather than one, because the list has three different
 * failure modes and one `PUT /sizes` would have to serve all of them badly:
 *
 *   - `POST` creates. A list is not one document — the ids are permanent, so
 *     "replace the whole list" would mean destroying every id and re-issuing it,
 *     which is the one thing this resource must never do.
 *   - `PATCH /:id` renames, and the body is `strict()`: a client that sends an
 *     `id` or a `position` gets a 400 rather than a 200 that quietly changed
 *     only the name. Re-pointing an id is how every `colorways[].stock` key and
 *     every `?size=` URL silently breaks, so it is refused, not ignored.
 *   - `DELETE /:id` removes one and spends its id. `POST /reset` exists for the
 *     same reason the guides have one: a way back to a known-good list.
 */

const router = Router();

/**
 * Validates a create body, synchronously, before the controller runs.
 *
 * Same shape as `validateGuideFor`: zod's `parse` throws, and a synchronous
 * throw inside a middleware is something Express catches without help. The
 * controller is then mounted directly, so its own promise is the one Express
 * sees — which is the part that matters. Calling it from inside another
 * function instead would discard that promise, and a service-thrown
 * `ApiError` — the 409 for a duplicate name, say — would leave the request
 * hanging rather than answering.
 */
function validateCreate(req, res, next) {
  req.body = createSizeSchema.parse(req.body);
  next();
}

/** A rename body, which is strict: anything but a name is refused. */
function validateRename(req, res, next) {
  req.body = renameSizeSchema.parse(req.body);
  next();
}

// Reading is open to any signed-in member of this boundary. The list is public
// content — the storefront reads it with its own token and a shopper's cart
// needs it — so the staff read is for convenience, not secrecy.
router.get("/", authenticate, requireBoundary, listSizes);
router.get("/:id", authenticate, requireBoundary, getSize);

// Writing takes "edit" on Sizes & Guides, the same gate as the size guides.
const mayEditSizes = requireAccess("sizes:edit");

// Declared before `/:id` so a reset cannot be read as a size whose id is
// literally "reset".
router.post("/reset", authenticate, requireBoundary, mayEditSizes, resetSizes);

router.post("/", authenticate, requireBoundary, mayEditSizes, validateCreate, createSize);
router.patch("/:id", authenticate, requireBoundary, mayEditSizes, validateRename, renameSize);
router.delete("/:id", authenticate, requireBoundary, mayEditSizes, deleteSize);

export default router;
