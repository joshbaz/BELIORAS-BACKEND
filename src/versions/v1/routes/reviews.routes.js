/* Review Routes */

import { Router } from "express";
import { z } from "zod";
import { validateWithReason as validate } from "../../../middlewares/validate.js";
import * as reviews from "../../../features/reviews/reviews.service.js";
import { requestMeta } from "../../../features/audit/audit.js";
import { authenticate, optionalAuthenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";

/**
 * Reviews: shoppers read published ones and submit their own (pending until
 * moderated); the roles the dashboard grants "edit" on Reviews publish, hide
 * and reply.
 */

const createSchema = z
  .object({
    productId: z.string().trim().min(1).max(80),
    rating: z.number().int().min(1, "Choose a rating from 1 to 5.").max(5, "Choose a rating from 1 to 5."),
    title: z.string().trim().max(120).optional(),
    body: z.string().trim().min(1, "Say a little about how it wears.").max(4000),
    name: z.string().trim().max(80).optional(),
  })
  .strict();
const replySchema = z.object({ text: z.string().max(2000).default("") }).strict();

export const publicReviews = Router();

publicReviews.get("/reviews", async (req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  const limit = req.query.limit ? Math.min(50, Math.max(1, Number(req.query.limit) || 3)) : undefined;
  res.json({ data: await reviews.listPublished({ productId: req.query.productId ? String(req.query.productId) : undefined, limit }) });
});

publicReviews.post("/reviews", optionalAuthenticate, validate(createSchema), async (req, res) => {
  res.status(201).json({ data: await reviews.createReview(req.body, req.user ?? null) });
});

export const adminReviews = Router();
const mayModerate = requireAccess("reviews:edit");

adminReviews.get("/reviews", authenticate, requireBoundary, mayModerate, async (req, res) => {
  res.json({ data: await reviews.listAll() });
});
adminReviews.post("/reviews/:id/publish", authenticate, requireBoundary, mayModerate, async (req, res) => {
  res.json({ data: await reviews.publishReview(req.params.id, req.user, requestMeta(req)) });
});
adminReviews.post("/reviews/:id/hide", authenticate, requireBoundary, mayModerate, async (req, res) => {
  res.json({ data: await reviews.hideReview(req.params.id, req.user, requestMeta(req)) });
});
adminReviews.put("/reviews/:id/reply", authenticate, requireBoundary, mayModerate, validate(replySchema), async (req, res) => {
  res.json({ data: await reviews.replyToReview(req.params.id, req.body.text, req.user, requestMeta(req)) });
});
