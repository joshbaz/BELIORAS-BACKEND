/* Fit Model Routes */

import { Router } from "express";
import { z } from "zod";
import { validateWithReason as validate } from "../../../middlewares/validate.js";
import * as models from "../../../features/models/models.service.js";
import { requestMeta } from "../../../features/audit/audit.js";
import { mediaUrl } from "../schemas/products.schema.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";

/** Fit models: shoppers read them; "edit" on Sizes & Guides changes them. */

const cm = (label, min, max) =>
  z.number().int().min(min, `${label} should be between ${min} and ${max} cm.`).max(max, `${label} should be between ${min} and ${max} cm.`).nullable().optional();

const modelSchema = z
  .object({
    name: z.string().trim().min(1, "Give the model a name.").max(80),
    photo: mediaUrl.nullable().optional(),
    heightCm: cm("Height", 140, 210),
    bustCm: cm("Bust", 60, 140),
    waistCm: cm("Waist", 45, 130),
    hipCm: cm("Hip", 60, 150),
  })
  .strict();

export const publicModels = Router();
publicModels.get("/models", async (req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  res.json({ data: await models.listModels() });
});

export const adminModels = Router();
const staffIn = [authenticate, requireBoundary];
const mayEdit = requireAccess("sizes:edit");

adminModels.get("/models", ...staffIn, async (req, res) => res.json({ data: await models.listModels() }));
adminModels.get("/models/usage", ...staffIn, async (req, res) => res.json({ data: await models.modelUsage() }));
adminModels.post("/models", ...staffIn, mayEdit, validate(modelSchema), async (req, res) => {
  res.status(201).json({ data: await models.createModel(req.body, req.user, requestMeta(req)) });
});
adminModels.patch("/models/:id", ...staffIn, mayEdit, validate(modelSchema), async (req, res) => {
  res.json({ data: await models.updateModel(req.params.id, req.body, req.user, requestMeta(req)) });
});
adminModels.delete("/models/:id", ...staffIn, mayEdit, async (req, res) => {
  res.json({ data: await models.deleteModel(req.params.id, req.user, requestMeta(req)) });
});
