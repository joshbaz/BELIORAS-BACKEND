/* Order Service */

import { readFileSync } from "node:fs";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { env } from "../../config/index.js";
import { audit } from "../audit/audit.js";
import { assertRedeemable } from "../coupons/coupons.service.js";
import { queueEmail } from "../emails/emails.service.js";
import { orderMovements } from "../inventory/inventory.service.js";
import { paymentsFor, refund as refundPayment, simulateCharge } from "../payments/payments.service.js";
import { present as presentProduct } from "../products/products.service.js";
import { ANY, onHandOf } from "../products/stock.js";
import { getStoreSettings } from "../settings/settings.service.js";
import { inTransaction, lock, nextValue } from "./counters.js";
import { computeTotals, round2 } from "./pricing.js";
import { HOLDING, colorIdsByName, reservedUnits, variantKey, variantOf } from "./reserve.js";

/**
 * Orders: placing them, paying for them, and every change after.
 *
 * ## Checkout is decided here
 *
 * The browser sends what is in the bag and what it showed the shopper. The
 * server prices every line from the catalogue, checks the coupon, works out
 * shipping and VAT from the store settings, and refuses (409) if its total is
 * not the one the shopper saw — a price or a code changed in between.
 *
 * Availability is checked inside a transaction that first writes a lock per
 * product (see `counters.js`), so two shoppers buying the last piece at once
 * take turns: the second sees the first one's order and is told it sold out.
 *
 * ## Numbers are issued once
 *
 * Order references, invoice numbers and credit-note numbers come from
 * `Counter`, inside the transaction that uses them, so they never repeat and
 * — for invoices, which German law requires — never skip.
 *
 * ## Stock follows the order
 *
 * Placed orders hold their units (nothing moves). Shipping takes them off the
 * shelf, once; a refund can put them back. Those changes go through the
 * inventory service, which writes the stock history in the same step.
 */

export const SEED_ORDERS = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));
const ENDED = ["cancelled", "refunded"];

const ALIASES = {
  "to-pay": "to-pay", pending: "to-pay", unpaid: "to-pay",
  "to-ship": "to-ship", paid: "to-ship", processing: "to-ship",
  shipped: "shipped", "in-transit": "shipped",
  "to-review": "to-review", delivered: "to-review",
  reviewed: "reviewed", cancelled: "cancelled", canceled: "cancelled", refunded: "refunded",
};
export const normalizeStatus = (s) => ALIASES[String(s ?? "").toLowerCase()] ?? null;

/** Where staff may move an order by hand. Payment, cancelling and refunds have their own flows. */
const NEXT = { "to-pay": ["cancelled"], "to-ship": ["shipped", "cancelled"], shipped: ["to-review", "refunded"], "to-review": ["refunded"] };

const iso = (d) => (d ? new Date(d).toISOString() : null);

export function present(order) {
  if (!order) return null;
  return {
    ...order,
    paidAt: iso(order.paidAt),
    shippedAt: iso(order.shippedAt),
    deliveredAt: iso(order.deliveredAt),
    stockDeductedAt: iso(order.stockDeductedAt),
    stockReturnedAt: iso(order.stockReturnedAt),
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  };
}

/* ---------------------------------------------------------------- Access -- */

/**
 * Whether `who` may see this order: staff always; a signed-in customer if it is
 * theirs; anyone else only with the email it was placed with. A wrong guess
 * and a missing order answer the same 404, so a reference alone confirms
 * nothing — references are sequential and therefore guessable.
 */
function mayAccess(order, who) {
  if (who.staff) return true;
  if (who.userId && order.userId === who.userId) return true;
  const email = String(who.email ?? "").trim().toLowerCase();
  return Boolean(email) && order.email.toLowerCase() === email;
}

async function findFor(id, who, db = prisma) {
  const order = await db.order.findUnique({ where: { id } });
  if (!order || !mayAccess(order, who)) throw new ApiError("No order matches those details.", 404);
  return order;
}

export async function getOrder(id, who) {
  return present(await findFor(id, who));
}

/** A customer's own orders, newest first. */
export async function listMyOrders(userId) {
  return (await prisma.order.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })).map(present);
}

/** Every order, newest first, for the dashboard. */
export async function listOrders() {
  return (await prisma.order.findMany({ orderBy: { createdAt: "desc" } })).map(present);
}

/* -------------------------------------------------------------- Checkout -- */

async function nextOrderId(db) {
  const n = await nextValue(db, "order", async () => {
    const rows = await db.order.findMany({ select: { id: true } });
    return rows.reduce((max, o) => Math.max(max, Number(String(o.id).replace(/\D/g, "")) || 0), 1000);
  });
  return `ORD-${n}`;
}

/**
 * Prices and snapshots each line from the catalogue: the price charged is the
 * product's, never the browser's, and the line keeps the name, photo, colour
 * and size as sold.
 */
async function priceLines(db, items) {
  const ids = [...new Set(items.map((i) => i.productId))];
  const rows = await db.product.findMany({ where: { id: { in: ids } } });
  const products = new Map(rows.filter((r) => !r.deletedAt && r.status === "active").map((r) => [r.id, presentProduct(r)]));
  const byName = await colorIdsByName(db);
  const colorNames = new Map((await db.color.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));

  return items.map((item) => {
    const product = products.get(item.productId);
    if (!product) throw new ApiError("A piece in your bag is no longer available. Remove it and try again.", 409);

    const ways = product.colorways ?? [];
    let colorId = null;
    if (ways.length) {
      colorId = item.color ? byName.get(String(item.color).toLowerCase()) : ways.length === 1 ? ways[0].colorId : null;
      if (!colorId || !ways.some((w) => w.colorId === colorId)) {
        throw new ApiError(`Choose a colour ${product.name} comes in.`, 422);
      }
    }
    const sizes = (product.sizes ?? []).filter((s) => s !== "one-size");
    const size = item.size ? String(item.size).toLowerCase() : null;
    if (sizes.length && !sizes.includes(size)) throw new ApiError(`Choose a size ${product.name} comes in.`, 422);

    const way = ways.find((w) => w.colorId === colorId);
    return {
      product,
      line: {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        size: item.size ?? null,
        color: colorId ? colorNames.get(colorId) ?? item.color : item.color ?? null,
        colorId,
        image: way?.images?.[0] ?? product.images?.[0] ?? null,
      },
    };
  });
}

/** Lines asking for more than is available, as messages a shopper can act on. */
function availabilityProblems(priced, reserved, byName, colorNames) {
  const wanted = new Map();
  for (const { product, line } of priced) {
    const { colorId, size } = variantOf(product, line, byName);
    const key = variantKey(product.id, colorId, size);
    const entry = wanted.get(key) ?? { product, colorId, size, qty: 0 };
    entry.qty += line.quantity;
    wanted.set(key, entry);
  }
  const problems = [];
  for (const [key, { product, colorId, size, qty }] of wanted) {
    const held = colorId === ANY ? (reserved.get(variantKey(product.id)) ?? 0) : (reserved.get(key) ?? 0);
    const available = Math.max(0, onHandOf(product, colorId, size) - held);
    if (qty <= available) continue;
    const where = [colorNames.get(colorId), size !== ANY && size !== "one-size" ? String(size).toUpperCase() : null].filter(Boolean).join(", ");
    problems.push(
      available === 0
        ? `${product.name}${where ? ` in ${where}` : ""} has just sold out.`
        : `Only ${available} left of ${product.name}${where ? ` in ${where}` : ""}.`,
    );
  }
  return problems;
}

/**
 * Places an order, waiting for payment and holding its stock. `customer` is the
 * signed-in shopper, or null for a guest.
 */
export async function checkout(body, customer) {
  const email = (customer?.email ?? body.email).trim().toLowerCase();
  const settings = await getStoreSettings();

  return present(
    await inTransaction(async (tx) => {
      // Lock first, then read: see counters.js.
      for (const id of [...new Set(body.items.map((i) => i.productId))]) await lock(tx, `product:${id}`);
      if (body.couponCode) await lock(tx, `coupon:${body.couponCode.trim().toUpperCase()}`);

      const priced = await priceLines(tx, body.items);
      const byName = await colorIdsByName(tx);
      const colorNames = new Map((await tx.color.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const reserved = await reservedUnits(tx, priced.map((p) => p.product.id));
      const problems = availabilityProblems(priced, reserved, byName, colorNames);
      if (problems.length) throw new ApiError(problems.join(" "), 409);

      const lines = priced.map((p) => p.line);
      const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
      const coupon = body.couponCode
        ? await assertRedeemable(tx, body.couponCode, subtotal, { userId: customer?.id ?? null, email })
        : null;

      const totals = computeTotals({ lines, country: body.country, coupon, settings });
      if (!totals.shippable) throw new ApiError(`We don't ship to ${body.country} yet.`, 422);
      if (body.expectedTotal != null && Math.abs(body.expectedTotal - totals.total) > 0.009) {
        throw new ApiError(
          `The total has changed to €${totals.total.toFixed(2)} since you started checking out — a price or your code changed. Check your bag and place the order again.`,
          409,
          { details: { totals } },
        );
      }

      return tx.order.create({
        data: {
          id: await nextOrderId(tx),
          userId: customer?.id ?? null,
          email,
          name: body.name?.trim() || null,
          phone: body.phone?.trim() || null,
          items: lines,
          subtotal: totals.subtotal,
          discount: totals.discount,
          shipping: totals.shipping,
          tax: totals.tax,
          total: totals.total,
          couponCode: coupon?.code ?? null,
          country: body.country,
          shippingAddress: body.shippingAddress ?? null,
          status: "to-pay",
          creditNotes: [],
        },
      });
    }),
  );
}

/* --------------------------------------------------------------- Payment -- */

export function paymentsSimulated() {
  if (env.PAYMENTS_SIMULATED) return env.PAYMENTS_SIMULATED === "true";
  return env.NODE_ENV !== "production";
}

async function nextInvoiceNumber(db, prefix) {
  const year = new Date().getFullYear();
  const stem = `${prefix}-${year}-`;
  const n = await nextValue(db, `invoice:${stem}`, async () => {
    const rows = await db.order.findMany({ where: { invoiceNumber: { startsWith: stem } }, select: { invoiceNumber: true } });
    return rows.reduce((max, o) => Math.max(max, Number(o.invoiceNumber.slice(stem.length)) || 0), 0);
  });
  return `${stem}${String(n).padStart(4, "0")}`;
}

/**
 * Payment succeeded — what a provider's webhook will do, and the only way an
 * order becomes paid. It gets its invoice number, once and in sequence, and
 * the confirmation email is queued.
 */
async function confirmPayment(tx, order, charge) {
  if (normalizeStatus(order.status) !== "to-pay") return order;
  const settings = await getStoreSettings(tx);
  const updated = await tx.order.update({
    where: { id: order.id },
    data: {
      status: "to-ship",
      paidAt: new Date(),
      paymentMethod: charge?.method?.type ?? null,
      invoiceNumber: order.invoiceNumber ?? (await nextInvoiceNumber(tx, settings.invoice?.prefix || "INV")),
    },
  });
  await queueEmail(tx, {
    type: "order-confirmation",
    to: updated.email,
    subject: `Your Belioras order ${updated.id} is confirmed`,
    orderId: updated.id,
    data: { invoiceNumber: updated.invoiceNumber, total: updated.total },
  });
  return updated;
}

/** The development payment stand-in: charges and confirms at once. Refused where payments are not simulated. */
export async function simulatePayment(id, { method = "card" }, who) {
  if (!paymentsSimulated()) throw new ApiError("Payments are taken by the payment provider here.", 403);
  return present(
    await inTransaction(async (tx) => {
      const order = await findFor(id, who, tx);
      if (normalizeStatus(order.status) !== "to-pay") return order;
      const charge = await simulateCharge(tx, order, method);
      return confirmPayment(tx, order, charge);
    }),
  );
}

/* ---------------------------------------------------------------- Refunds -- */

/** What each line is worth after the order's discount, so a refund gives back what was paid for it. */
function paidShare(order, line) {
  const gross = (line.price ?? 0) * (line.quantity ?? 1);
  const ratio = order.subtotal ? Math.max(0, 1 - (order.discount ?? 0) / order.subtotal) : 1;
  return round2(gross * ratio);
}

async function nextCreditNoteNumber(db, prefix) {
  const stem = `${prefix}-CN-${new Date().getFullYear()}-`;
  const n = await nextValue(db, `credit:${stem}`, async () => {
    const orders = await db.order.findMany({ select: { creditNotes: true } });
    return orders
      .flatMap((o) => o.creditNotes ?? [])
      .reduce((max, cn) => Math.max(max, String(cn.number).startsWith(stem) ? Number(cn.number.slice(stem.length)) || 0 : 0), 0);
  });
  return `${stem}${String(n).padStart(4, "0")}`;
}

/** Stock changes for an order's lines, as the inventory service takes them. */
async function stockLines(db, order, chosen) {
  const ids = [...new Set(chosen.map((c) => c.line.productId))];
  const products = new Map((await db.product.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, presentProduct(p)]));
  const byName = await colorIdsByName(db);
  return chosen
    .filter((c) => products.has(c.line.productId))
    .map((c) => ({ productId: c.line.productId, ...variantOf(products.get(c.line.productId), c.line, byName), quantity: c.quantity }));
}

/**
 * Gives money back — the whole order or part of it — and issues a credit note,
 * since an invoice, once issued, is never edited. `lines` picks what is being
 * refunded (`[{ index, quantity }]`); `amount` may override the total. Pieces
 * that came back can go back on the shelf. A refund that leaves nothing paid
 * closes the order: "cancelled" if it never shipped, "refunded" if it had.
 */
async function applyRefund(order, { lines = [], includeShipping = false, amount = null, reason = "", restock = false, cancel = false }, actor) {
  const { refundable } = await paymentsFor(prisma, order.id);
  if (refundable <= 0) throw new ApiError("Nothing is left to refund on this order.", 409);

  const chosen = lines
    .map(({ index, quantity }) => ({ line: order.items[index], index, quantity: Math.min(Number(quantity) || 0, order.items[index]?.quantity ?? 1) }))
    .filter((c) => c.line && c.quantity > 0);
  const fromLines = chosen.reduce((s, c) => s + (paidShare(order, c.line) / (c.line.quantity ?? 1)) * c.quantity, 0);
  const suggested = round2(fromLines + (includeShipping ? order.shipping ?? 0 : 0));
  const total = round2(amount === null || amount === undefined || amount === "" ? suggested : Number(amount));
  if (!(total > 0)) throw new ApiError("Choose what to refund, or enter an amount.", 422);
  if (total > refundable + 0.001) throw new ApiError(`At most €${refundable.toFixed(2)} can be refunded on this order.`, 422);

  // Pieces only go back on the shelf if they had left it. Before the money
  // moves, so a restock that fails stops the refund rather than leaving the
  // shelf short.
  if (restock && order.stockDeductedAt && chosen.length) {
    await orderMovements({ orderId: order.id, reason: "returned", lines: await stockLines(prisma, order, chosen) }, actor);
  }

  const settings = await getStoreSettings();
  const updated = await inTransaction(async (tx) => {
    const fresh = await tx.order.findUnique({ where: { id: order.id } });
    const txn = await refundPayment(tx, order.id, total, reason);
    const creditNote = {
      number: await nextCreditNoteNumber(tx, settings.invoice?.prefix || "INV"),
      at: new Date().toISOString(),
      amount: total,
      reason: reason || null,
      shipping: includeShipping ? order.shipping ?? 0 : 0,
      lines: chosen.map((c) => ({
        name: c.line.name, color: c.line.color, size: c.line.size, quantity: c.quantity,
        gross: round2((paidShare(order, c.line) / (c.line.quantity ?? 1)) * c.quantity),
      })),
      transactionId: txn?.id ?? null,
    };
    const left = round2(refundable - total);
    const status = normalizeStatus(fresh.status);
    const nextStatus = left <= 0 || cancel ? (fresh.stockDeductedAt ? "refunded" : "cancelled") : status;
    const saved = await tx.order.update({
      where: { id: order.id },
      data: {
        status: nextStatus,
        creditNotes: [...(fresh.creditNotes ?? []), creditNote],
        ...(restock && fresh.stockDeductedAt && chosen.length ? { stockReturnedAt: new Date() } : {}),
        ...(cancel && reason ? { cancelReason: reason } : {}),
      },
    });
    await queueEmail(tx, { type: "refund", to: order.email, subject: `Your refund for Belioras order ${order.id}`, orderId: order.id, data: { amount: total, creditNote: creditNote.number } });
    if (nextStatus === "cancelled" && status !== "cancelled") {
      await queueEmail(tx, { type: "order-cancelled", to: order.email, subject: `Your Belioras order ${order.id} is cancelled`, orderId: order.id, data: { refunded: total } });
    }
    return { order: saved, creditNote };
  });
  return { order: present(updated.order), creditNote: updated.creditNote };
}

export async function refundOrder(id, options, actor, meta = {}) {
  const order = await findFor(id, { staff: true });
  if (!["to-ship", "shipped", "to-review", "reviewed", "refunded"].includes(normalizeStatus(order.status))) {
    throw new ApiError("Only a paid order can be refunded.", 409);
  }
  const result = await applyRefund(order, options, actor);
  await audit(actor.id, "staff", "ORDER_REFUND", { ...meta, meta: { id, amount: result.creditNote.amount, creditNote: result.creditNote.number } });
  return result;
}

/* ------------------------------------------------------------ Transitions -- */

/**
 * Cancels an order before it ships. Unpaid, it is simply cancelled; paid, the
 * whole amount goes back first, with a credit note. For staff, and for a
 * customer's own order.
 */
export async function cancelOrder(id, { reason }, who, actor = null, meta = {}) {
  const order = await findFor(id, who);
  const status = normalizeStatus(order.status);
  let result;
  if (status === "to-pay") {
    const saved = await inTransaction(async (tx) => {
      const updated = await tx.order.update({ where: { id }, data: { status: "cancelled", cancelReason: reason ?? null } });
      await queueEmail(tx, { type: "order-cancelled", to: order.email, subject: `Your Belioras order ${order.id} is cancelled`, orderId: order.id, data: { refunded: 0 } });
      return updated;
    });
    result = { order: present(saved), creditNote: null };
  } else if (status === "to-ship") {
    result = await applyRefund(
      order,
      {
        lines: order.items.map((line, index) => ({ index, quantity: line.quantity ?? 1 })),
        includeShipping: true,
        reason: reason || "Order cancelled before shipping",
        cancel: true,
      },
      actor,
    );
  } else {
    throw new ApiError("An order that has shipped can't be cancelled. Refund it once the pieces are back.", 409);
  }
  if (actor) {
    await audit(actor.id, "staff", "ORDER_CANCEL", { ...meta, meta: { id, refunded: result.creditNote?.amount ?? 0 } });
  }
  return result;
}

/**
 * Moves a paid order along: shipped, then delivered. Shipping takes its pieces
 * off the shelf, once — before the order is written, so a failure leaves the
 * order as it was and it can be tried again.
 */
export async function updateOrderStatus(id, { status, trackingRef, carrier }, actor, meta = {}) {
  const canonical = normalizeStatus(status);
  if (!canonical) throw new ApiError(`Unknown order status: ${status}`, 422);
  const order = await findFor(id, { staff: true });
  const from = normalizeStatus(order.status);

  if (canonical === "to-ship") throw new ApiError("An order is marked paid by the payment provider when payment succeeds, never by hand.", 409);
  if (ENDED.includes(canonical)) throw new ApiError("Use Cancel or Refund on the order, so the payment is handled too.", 409);
  if (!(NEXT[from] ?? []).includes(canonical)) throw new ApiError(`An order that is ${from} can't become ${canonical}.`, 409);

  const shipping = HOLDING.includes(from) && !ENDED.includes(canonical) && !order.stockDeductedAt;
  if (shipping) {
    await orderMovements(
      { orderId: id, reason: "sold", lines: await stockLines(prisma, order, order.items.map((line) => ({ line, quantity: Number(line.quantity) || 1 }))) },
      actor,
    );
  }

  const saved = await inTransaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id },
      data: {
        status: canonical,
        ...(shipping ? { stockDeductedAt: new Date() } : {}),
        ...(canonical === "shipped" ? { shippedAt: new Date() } : {}),
        ...(canonical === "to-review" ? { deliveredAt: new Date() } : {}),
        ...(trackingRef ? { trackingRef } : {}),
        ...(carrier ? { carrier } : {}),
      },
    });
    if (canonical === "shipped") {
      await queueEmail(tx, { type: "order-shipped", to: order.email, subject: `Your Belioras order ${id} is on its way`, orderId: id, data: { carrier: updated.carrier, trackingRef: updated.trackingRef } });
    }
    if (canonical === "to-review") {
      await queueEmail(tx, { type: "order-delivered", to: order.email, subject: `Your Belioras order ${id} has arrived`, orderId: id, data: {} });
    }
    return updated;
  });
  await audit(actor.id, "staff", "ORDER_STATUS", { ...meta, meta: { id, from, to: canonical } });
  return present(saved);
}

export async function resendConfirmation(id, actor, meta = {}) {
  const order = await findFor(id, { staff: true });
  if (!order.invoiceNumber) throw new ApiError("This order has not been paid yet, so there is no confirmation to resend.", 409);
  await queueEmail(prisma, {
    type: "order-confirmation",
    to: order.email,
    subject: `Your Belioras order ${order.id} is confirmed`,
    orderId: order.id,
    data: { invoiceNumber: order.invoiceNumber, resent: true },
  });
  await audit(actor.id, "staff", "ORDER_RESEND", { ...meta, meta: { id } });
  return present(order);
}

/* --------------------------------------------------------------- Invoices -- */

/**
 * Everything an invoice prints: the seller from the store settings, the buyer,
 * each line with its net price and VAT, and the totals. VAT is included in the
 * prices, so it is worked out of them. `creditNumber` prints a credit note.
 */
export async function getInvoice(id, who, creditNumber = null) {
  const order = present(await findFor(id, who));
  if (!order.invoiceNumber) throw new ApiError("This order has no invoice yet: one is issued when payment is confirmed.", 409);
  const settings = await getStoreSettings();
  const rate = settings.tax?.rate ?? 0;
  const net = (gross) => Math.round((gross / (1 + rate)) * 100) / 100;
  const seller = {
    name: settings.gpsr?.manufacturer ?? "Belioras",
    address: settings.gpsr?.address ?? settings.contact?.boutique ?? "",
    email: settings.contact?.support ?? "",
    vatId: settings.invoice?.vatId ?? "",
    taxNumber: settings.invoice?.taxNumber ?? "",
    note: settings.invoice?.note ?? "",
  };

  if (creditNumber) {
    const cn = (order.creditNotes ?? []).find((c) => c.number === creditNumber);
    if (!cn) throw new ApiError("No credit note with that number on this order.", 404);
    const lines = cn.lines.map((l) => ({ ...l, price: -(l.gross / (l.quantity || 1)), gross: -l.gross, net: -net(l.gross) }));
    if (cn.shipping) lines.push({ name: "Shipping", quantity: 1, price: -cn.shipping, gross: -cn.shipping, net: -net(cn.shipping) });
    const covered = lines.reduce((s, l) => s + l.gross, 0);
    const rest = Math.round((-cn.amount - covered) * 100) / 100;
    if (Math.abs(rest) >= 0.01) lines.push({ name: "Adjustment", quantity: 1, price: rest, gross: rest, net: net(rest) });
    const vat = Math.round((cn.amount - net(cn.amount)) * 100) / 100;
    return { kind: "credit", creditNote: cn, order, seller, rate, lines, totals: { net: -net(cn.amount), vat: -vat, gross: -cn.amount } };
  }

  const lines = (order.items ?? []).map((i) => {
    const gross = (i.price ?? 0) * (i.quantity ?? 1);
    return { ...i, gross, net: net(gross) };
  });
  if (order.discount) lines.push({ name: `Discount${order.couponCode ? ` (${order.couponCode})` : ""}`, quantity: 1, price: -order.discount, gross: -order.discount, net: -net(order.discount) });
  if (order.shipping) lines.push({ name: "Shipping", quantity: 1, price: order.shipping, gross: order.shipping, net: net(order.shipping) });
  const total = order.total ?? 0;
  return { kind: "invoice", order, seller, rate, lines, totals: { net: Math.round((total - (order.tax ?? 0)) * 100) / 100, vat: order.tax ?? 0, gross: total } };
}

/* -------------------------------------------------------------- Rankings -- */

/** Units sold per product, most first — what "Best sellers" ranks by. Public: ids and counts, never orders. */
export async function bestSellers({ limit = 12, sinceDays = null } = {}) {
  const where = { status: { notIn: ENDED }, ...(sinceDays ? { createdAt: { gte: new Date(Date.now() - sinceDays * 86400000) } } : {}) };
  const orders = await prisma.order.findMany({ where, select: { items: true } });
  const units = new Map();
  for (const o of orders) for (const l of o.items ?? []) if (l.productId) units.set(l.productId, (units.get(l.productId) ?? 0) + (l.quantity ?? 1));
  return [...units.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([productId, n]) => ({ productId, units: n }));
}

/* ------------------------------------------------------------------- Seed -- */

/** A shipped order as a row. Lines keep their colour name; `colorId` is resolved on read when absent. */
export function seedOrder(o) {
  const date = (v) => (v ? new Date(v) : null);
  return {
    id: o.id,
    userId: o.userId ?? null,
    email: o.email ?? "guest@example.com",
    name: o.name ?? null,
    phone: o.phone ?? null,
    items: o.items ?? [],
    subtotal: o.subtotal ?? 0,
    discount: o.discount ?? 0,
    shipping: o.shipping ?? 0,
    tax: o.tax ?? 0,
    total: o.total ?? 0,
    couponCode: o.couponCode ?? null,
    country: o.country ?? null,
    shippingAddress: o.shippingAddress ?? null,
    status: normalizeStatus(o.status) ?? "to-pay",
    invoiceNumber: o.invoiceNumber ?? null,
    paymentMethod: o.paymentMethod ?? null,
    paidAt: date(o.paidAt),
    shippedAt: date(o.shippedAt),
    deliveredAt: date(o.deliveredAt),
    trackingRef: o.trackingRef ?? null,
    carrier: o.carrier ?? null,
    cancelReason: o.cancelReason ?? null,
    stockDeductedAt: date(o.stockDeductedAt),
    stockReturnedAt: date(o.stockReturnedAt),
    creditNotes: o.creditNotes ?? [],
    createdAt: date(o.createdAt) ?? new Date(),
  };
}
