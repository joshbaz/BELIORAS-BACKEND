/* Newsletter And Contact Routes */

import { Router } from "express";
import { z } from "zod";
import { validateWithReason as validate } from "../../../middlewares/validate.js";
import { createAuthLimiter } from "../../../middlewares/rateLimit.js";
import * as m from "../../../features/marketing/marketing.service.js";
import { requestMeta } from "../../../features/audit/audit.js";
import { authenticate, optionalAuthenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireAccess } from "../middlewares/requireAccess.js";

/**
 * Shoppers join and leave the Letter and write through the contact form —
 * both take an email from anyone, so both are rate limited. The dashboard's
 * Newsletter page (staff, content, administrators) manages the audience and
 * campaigns; client care reads contact messages.
 */

const email = z.string().trim().toLowerCase().email("Please enter a valid email address.").max(200);
const linkToken = z.object({ token: z.string().trim().min(10).max(100) }).strict();
const subscribeSchema = z.object({ email, name: z.string().trim().max(120).nullable().optional(), source: z.string().trim().max(40).optional() }).strict();
const contactSchema = z
  .object({
    name: z.string().trim().min(1, "Please complete every required field.").max(120),
    email,
    subject: z.string().trim().max(120).optional(),
    message: z.string().trim().min(1, "Please complete every required field.").max(5000),
  })
  .strict();
const campaignSchema = z
  .object({
    id: z.string().max(80).optional(),
    subject: z.string().trim().min(1, "Add a subject line.").max(200),
    previewText: z.string().max(300).optional(),
    heading: z.string().max(200).optional(),
    body: z.string().max(20000).optional(),
    productIds: z.array(z.string().max(80)).max(10).optional(),
    cta: z.object({ label: z.string().max(80).optional(), url: z.string().max(500).optional() }).optional(),
  })
  .strict();
const welcomeSchema = z
  .object({ enabled: z.boolean(), couponCode: z.string().max(40).nullable().optional(), subject: z.string().max(200).optional(), heading: z.string().max(200).optional(), body: z.string().max(10000).optional() })
  .strict();

const limiter = createAuthLimiter();
const wrap = (fn) => async (req, res) => res.json({ data: await fn(req) });

export const publicMarketing = Router();

publicMarketing.post("/newsletter/subscribe", limiter, optionalAuthenticate, validate(subscribeSchema), wrap((req) => m.subscribe(req.body, req.user ?? null)));
publicMarketing.post("/newsletter/confirm", validate(linkToken), wrap((req) => m.confirmSubscription(req.body.token)));
publicMarketing.post("/newsletter/unsubscribe", validate(linkToken), wrap((req) => m.unsubscribe(req.body.token)));
publicMarketing.get("/newsletter/subscription", authenticate, requireBoundary, wrap((req) => m.getMySubscription(req.user.email)));
publicMarketing.post("/newsletter/unsubscribe-me", authenticate, requireBoundary, wrap((req) => m.unsubscribeMe(req.user.email)));
publicMarketing.post("/contact", limiter, validate(contactSchema), async (req, res) => {
  res.status(201).json({ data: await m.sendContactMessage(req.body) });
});

export const adminMarketing = Router();
const staffIn = [authenticate, requireBoundary];
const mayEdit = requireAccess("newsletter:edit");

adminMarketing.get("/newsletter/subscribers", ...staffIn, mayEdit, wrap(() => m.listSubscribers()));
adminMarketing.post("/newsletter/subscribers/:id/unsubscribe", ...staffIn, mayEdit, wrap((req) => m.unsubscribeSubscriber(req.params.id, req.user, requestMeta(req))));
adminMarketing.delete("/newsletter/subscribers/:id", ...staffIn, mayEdit, wrap((req) => m.eraseSubscriber(req.params.id, req.user, requestMeta(req))));
adminMarketing.get("/newsletter/audience", ...staffIn, mayEdit, wrap(() => m.audienceSize()));
adminMarketing.get("/newsletter/settings", ...staffIn, mayEdit, wrap(() => m.getNewsletterSettings()));
adminMarketing.put("/newsletter/welcome", ...staffIn, mayEdit, validate(welcomeSchema), wrap((req) => m.updateWelcomeEmail(req.body, req.user, requestMeta(req))));
adminMarketing.get("/newsletter/campaigns", ...staffIn, mayEdit, wrap(() => m.listCampaigns()));
adminMarketing.post("/newsletter/campaigns", ...staffIn, mayEdit, validate(campaignSchema), wrap((req) => m.saveCampaign(req.body, req.user, requestMeta(req))));
adminMarketing.post("/newsletter/campaigns/:id/schedule", ...staffIn, mayEdit, wrap((req) => m.scheduleCampaign(req.params.id, req.body?.sendAt, req.user, requestMeta(req))));
adminMarketing.post("/newsletter/campaigns/:id/unschedule", ...staffIn, mayEdit, wrap((req) => m.unscheduleCampaign(req.params.id)));
adminMarketing.post("/newsletter/campaigns/:id/send", ...staffIn, mayEdit, wrap((req) => m.sendCampaign(req.params.id, req.user, requestMeta(req))));
adminMarketing.delete("/newsletter/campaigns/:id", ...staffIn, mayEdit, wrap((req) => m.deleteCampaign(req.params.id, req.user, requestMeta(req))));
adminMarketing.get("/contact/messages", ...staffIn, requireAccess("orders:view", "customers:view"), wrap(() => m.listContactMessages()));
