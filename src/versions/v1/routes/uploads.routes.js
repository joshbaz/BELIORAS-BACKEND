/* Upload Routes */

import { Router } from "express";
import multer from "multer";
import { ApiError } from "../../../core/ApiError.js";
import { LIMITS, storeUpload } from "../../../features/uploads/uploads.service.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";

/**
 * `POST /uploads` — one photo or video, as multipart field `file`, plus an
 * optional `folder` (products · menu · models). Answers `{ url, kind, … }`;
 * the caller saves that URL on the product, tile or model.
 *
 * Held in memory (at most the 100 MB video limit) and checked by its bytes in
 * the service before anything is stored.
 */

const router = Router();

const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.video, files: 1 } }).single("file");

/** multer's own errors (too big, wrong field) as answers rather than 500s. */
function receive(req, res, next) {
  parse(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return next(new ApiError("Videos can be up to 100 MB.", 413));
    return next(new ApiError("Send one file, in the field named \"file\".", 400));
  });
}

const FOLDERS = new Set(["products", "menu", "models"]);

async function upload(req, res) {
  const folder = FOLDERS.has(req.body?.folder) ? req.body.folder : "products";
  res.status(201).json({ data: await storeUpload(req.file, { folder }) });
}

// Whoever may edit something that carries a photo: products, the menu, fit models.
const mayUpload = requireAccess("products:edit", "mega-menu:edit", "sizes:edit");

router.post("/", authenticate, requireBoundary, mayUpload, receive, upload);

export default router;
