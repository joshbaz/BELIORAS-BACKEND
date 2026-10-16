/* Payments Service */

import { readFileSync } from "node:fs";
import { prisma } from "../../db/prisma.js";
import { nextValue } from "../orders/counters.js";
import { round2 } from "../orders/pricing.js";

/**
 * Money against orders: charges and refunds, as transaction records.
 *
 * No provider is connected yet. `simulateCharge` and `refund` succeed at once
 * and write the same records a Stripe / Mollie / PayPal webhook will, so the
 * order, its invoice, Transactions and Reports already behave as they will for
 * real. The simulated charge is reachable only where `PAYMENTS_SIMULATED` is on
 * (never in production by default), because it marks an order paid with no
 * money moving. A real provider replaces `simulateCharge` with its webhook and
 * `refund` with its refund call; everything downstream stays.
 */

export const SEED_TRANSACTIONS = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));

export const METHODS = {
  card: { provider: "stripe", method: { type: "card", brand: "visa", last4: "4242" } },
  paypal: { provider: "paypal", method: { type: "paypal" } },
};

/** What the provider keeps, roughly, so Transactions shows realistic net figures. */
function feeFor(provider, amount) {
  return provider === "paypal" ? round2(amount * 0.0249 + 0.35) : round2(amount * 0.015 + 0.25);
}

async function nextTxnId(db) {
  const n = await nextValue(db, "txn", async () => {
    const rows = await db.transaction.findMany({ select: { id: true } });
    return rows.reduce((max, t) => Math.max(max, Number(String(t.id).replace(/\D/g, "")) || 0), 0);
  });
  return `txn_${String(n).padStart(4, "0")}`;
}

export async function simulateCharge(db, order, methodId = "card") {
  const { provider, method } = METHODS[methodId] ?? METHODS.card;
  return db.transaction.create({
    data: {
      id: await nextTxnId(db),
      orderId: order.id,
      provider,
      providerRef: `${provider === "paypal" ? "PAYID" : "pi"}_sim_${Date.now().toString(36)}`,
      type: "charge",
      status: "succeeded",
      amount: order.total,
      currency: "EUR",
      fee: feeFor(provider, order.total),
      method,
      simulated: true,
    },
  });
}

/** Money taken for an order and already given back. */
export async function paymentsFor(db, orderId) {
  const txns = await db.transaction.findMany({ where: { orderId, status: "succeeded" }, orderBy: { createdAt: "asc" } });
  const charges = txns.filter((t) => t.type === "charge");
  const charged = round2(charges.reduce((s, t) => s + t.amount, 0));
  const refunded = round2(txns.filter((t) => t.type === "refund").reduce((s, t) => s + t.amount, 0));
  return { charges, charged, refunded, refundable: round2(Math.max(0, charged - refunded)) };
}

/** Gives money back against an order's latest charge, through the same provider. */
export async function refund(db, orderId, amount, reason) {
  const { charges } = await paymentsFor(db, orderId);
  const parent = charges.at(-1);
  if (!parent) return null;
  return db.transaction.create({
    data: {
      id: await nextTxnId(db),
      orderId,
      provider: parent.provider,
      providerRef: `re_sim_${Date.now().toString(36)}`,
      type: "refund",
      status: "succeeded",
      amount: round2(amount),
      currency: "EUR",
      fee: 0,
      method: parent.method ?? undefined,
      parentId: parent.id,
      reason: reason || null,
      simulated: parent.simulated,
    },
  });
}

/** Every transaction, newest first, shaped as the dashboard reads it (customer joined, refunds netted). */
export async function listTransactions({ orderId } = {}) {
  const txns = await prisma.transaction.findMany({ where: orderId ? { orderId } : {}, orderBy: { createdAt: "desc" } });
  const orders = new Map(
    (await prisma.order.findMany({ where: { id: { in: [...new Set(txns.map((t) => t.orderId))] } }, select: { id: true, name: true, email: true } })).map((o) => [o.id, o]),
  );
  return txns.map((t) => {
    const order = orders.get(t.orderId);
    const refunded = t.type === "charge" ? txns.filter((r) => r.parentId === t.id && r.status === "succeeded").reduce((s, r) => s + r.amount, 0) : 0;
    const signedAmount = t.type === "refund" ? -t.amount : t.amount;
    const displayStatus =
      t.type !== "charge" || t.status !== "succeeded" || refunded <= 0 ? t.status : refunded >= t.amount ? "refunded" : "partially-refunded";
    return {
      ...t,
      customer: order?.name ?? order?.email ?? "Guest",
      email: order?.email ?? null,
      refunded: round2(refunded),
      signedAmount,
      net: t.status === "succeeded" ? round2(signedAmount - (t.fee ?? 0)) : 0,
      displayStatus,
    };
  });
}
