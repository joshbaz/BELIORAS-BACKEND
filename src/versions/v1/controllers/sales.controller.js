/* Sales Controller: coupons, transactions, the email outbox, store settings */

import * as coupons from "../../../features/coupons/coupons.service.js";
import { listEmails } from "../../../features/emails/emails.service.js";
import { listTransactions } from "../../../features/payments/payments.service.js";
import { getStoreSettings, updateStoreSettings } from "../../../features/settings/settings.service.js";
import { requestMeta } from "../../../features/audit/audit.js";
import { prisma } from "../../../db/prisma.js";

export async function listCoupons(req, res) {
  res.json({ data: await coupons.listCoupons() });
}

export async function couponStats(req, res) {
  res.json({ data: await coupons.couponStats() });
}

export async function createCoupon(req, res) {
  res.status(201).json({ data: await coupons.createCoupon(req.body, req.user, requestMeta(req)) });
}

export async function updateCoupon(req, res) {
  res.json({ data: await coupons.updateCoupon(req.params.id, req.body, req.user, requestMeta(req)) });
}

export async function deleteCoupon(req, res) {
  res.json({ data: await coupons.deleteCoupon(req.params.id, req.user, requestMeta(req)) });
}

/** Checkout's "Apply". The same rules placing the order checks again. */
export async function validateCoupon(req, res) {
  const { code, subtotal, email } = req.body;
  res.json({ data: await coupons.assertRedeemable(prisma, code, subtotal, { userId: req.user?.id ?? null, email: req.user?.email ?? email }) });
}

export async function listTransactionsHandler(req, res) {
  res.json({ data: await listTransactions({ orderId: req.query.orderId ? String(req.query.orderId) : undefined }) });
}

export async function listEmailsHandler(req, res) {
  res.json({ data: await listEmails({ orderId: req.query.orderId ? String(req.query.orderId) : undefined }) });
}

export async function getSettings(req, res) {
  if (req.realm !== "staff") res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json({ data: await getStoreSettings() });
}

export async function updateSettings(req, res) {
  res.json({ data: await updateStoreSettings(req.body, req.user, requestMeta(req)) });
}
