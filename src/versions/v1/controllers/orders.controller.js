/* Order Controller */

import * as orders from "../../../features/orders/orders.service.js";
import { requestMeta } from "../../../features/audit/audit.js";

/**
 * Orders for shoppers and staff. Who is asking decides what they may see:
 * `who()` is staff in the admin boundary, the signed-in customer in the
 * storefront, or a guest proving the order with its email.
 */

function who(req) {
  if (req.realm === "staff") return { staff: true };
  return { userId: req.user?.id ?? null, email: req.body?.email ?? req.query?.email ?? null };
}

/* Storefront */

export async function checkout(req, res) {
  res.status(201).json({ data: await orders.checkout(req.body, req.user ?? null) });
}

export async function simulatePayment(req, res) {
  res.json({ data: await orders.simulatePayment(req.params.id, req.body, who(req)) });
}

export async function paymentConfig(req, res) {
  res.json({ data: { simulated: orders.paymentsSimulated() } });
}

export async function listMyOrders(req, res) {
  res.json({ data: await orders.listMyOrders(req.user.id) });
}

export async function getOrder(req, res) {
  res.json({ data: await orders.getOrder(req.params.id, who(req)) });
}

export async function getInvoice(req, res) {
  res.json({ data: await orders.getInvoice(req.params.id, who(req), req.query.credit ? String(req.query.credit) : null) });
}

export async function cancelMyOrder(req, res) {
  res.json({ data: await orders.cancelOrder(req.params.id, { reason: "Cancelled by the customer" }, who(req)) });
}

export async function bestSellers(req, res) {
  res.set("Cache-Control", "public, max-age=300");
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const sinceDays = req.query.sinceDays ? Number(req.query.sinceDays) : null;
  res.json({ data: await orders.bestSellers({ limit, sinceDays }) });
}

/* Dashboard */

export async function listOrders(req, res) {
  res.json({ data: await orders.listOrders() });
}

export async function updateStatus(req, res) {
  res.json({ data: await orders.updateOrderStatus(req.params.id, req.body, req.user, requestMeta(req)) });
}

export async function cancelOrder(req, res) {
  res.json({ data: await orders.cancelOrder(req.params.id, req.body, { staff: true }, req.user, requestMeta(req)) });
}

export async function refundOrder(req, res) {
  res.json({ data: await orders.refundOrder(req.params.id, req.body, req.user, requestMeta(req)) });
}

export async function resendConfirmation(req, res) {
  res.json({ data: await orders.resendConfirmation(req.params.id, req.user, requestMeta(req)) });
}
