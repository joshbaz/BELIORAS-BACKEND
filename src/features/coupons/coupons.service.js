/* Coupon Service */

import couponsSeed from "./seed.json" with { type: "json" };
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";

/**
 * Discount codes, and the one set of rules for whether a shopper may use one —
 * checkout's "Apply" and placing the order both ask `assertRedeemable`, and
 * placing the order asks again inside its transaction because the last use may
 * have gone in between.
 *
 * Uses are counted from orders, never stored: an order counts against a code
 * unless it was cancelled or refunded, which hands the use back.
 */

export const SEED_COUPONS = couponsSeed;
const RELEASED = ["cancelled", "refunded"];

function present(c) {
  if (!c) return null;
  const { createdAt, updatedAt, ...rest } = c;
  return { ...rest, expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null };
}

export async function listCoupons() {
  return (await prisma.coupon.findMany({ orderBy: { createdAt: "asc" } })).map(present);
}

/** Orders that still count against `code`. */
async function redemptions(db, code) {
  return db.order.findMany({
    where: { couponCode: { equals: code, mode: "insensitive" }, status: { notIn: RELEASED } },
    select: { userId: true, email: true, total: true, discount: true },
  });
}

/** The coupon if `customer` may use it on `subtotal` now; otherwise the reason, as an ApiError. */
export async function assertRedeemable(db, code, subtotal = 0, customer = null) {
  const coupon = await db.coupon.findFirst({ where: { code: { equals: String(code ?? "").trim(), mode: "insensitive" } } });
  if (!coupon || !coupon.active) throw new ApiError("This coupon code is not valid.", 404);
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) throw new ApiError("This coupon has expired.", 410);
  if (subtotal < (coupon.minOrderValue ?? 0)) {
    throw new ApiError(`This coupon requires a minimum order of €${coupon.minOrderValue}.`, 400);
  }
  const used = await redemptions(db, coupon.code);
  if (coupon.maxUses && used.length >= coupon.maxUses) throw new ApiError("This code has been fully redeemed.", 410);
  if (coupon.maxUsesPerCustomer && customer) {
    const email = String(customer.email ?? "").trim().toLowerCase();
    const mine = used.filter((o) => (customer.userId && o.userId === customer.userId) || (email && o.email.toLowerCase() === email)).length;
    if (mine >= coupon.maxUsesPerCustomer) {
      throw new ApiError(
        coupon.maxUsesPerCustomer === 1
          ? "You have already used this code."
          : `This code can be used ${coupon.maxUsesPerCustomer} times per customer, and you have used it that often.`,
        409,
      );
    }
  }
  return present(coupon);
}

/** What each code has done, and the totals across all of them, for the Discounts page. */
export async function couponStats() {
  const coupons = await prisma.coupon.findMany();
  const byCode = {};
  const allCustomers = new Set();
  const totals = { redemptions: 0, revenue: 0, discount: 0 };
  for (const coupon of coupons) {
    const orders = await redemptions(prisma, coupon.code);
    const customers = new Set(orders.map((o) => o.userId ?? o.email.toLowerCase()));
    customers.forEach((c) => allCustomers.add(c));
    const revenue = orders.reduce((s, o) => s + o.total, 0);
    const discount = orders.reduce((s, o) => s + o.discount, 0);
    byCode[coupon.code.toUpperCase()] = { orders: orders.length, customers: customers.size, revenue, discount };
    totals.redemptions += orders.length;
    totals.revenue += revenue;
    totals.discount += discount;
  }
  const live = await prisma.order.findMany({ where: { status: { notIn: RELEASED } }, select: { total: true } });
  const allRevenue = live.reduce((s, o) => s + o.total, 0);
  return { byCode, totals: { ...totals, customers: allCustomers.size, allRevenue } };
}

function fields(body) {
  const code = body.code.trim().toUpperCase();
  return {
    code,
    type: body.type,
    value: body.type === "free_shipping" ? 0 : body.value,
    minOrderValue: body.minOrderValue ?? 0,
    maxDiscount: body.maxDiscount ?? null,
    maxUses: body.maxUses ?? null,
    maxUsesPerCustomer: body.maxUsesPerCustomer ?? null,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    active: body.active ?? true,
    description: (body.description ?? "").trim(),
  };
}

function checkValue({ type, value }) {
  if (type === "percent" && (!(value > 0) || value > 100)) throw new ApiError("A percentage discount must be between 1 and 100.", 422);
  if (type === "fixed" && !(value > 0)) throw new ApiError("A fixed discount must be a positive amount.", 422);
}

async function assertCodeFree(code, exceptId = null) {
  const clash = await prisma.coupon.findFirst({ where: { code: { equals: code, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw new ApiError(`${code} is already in use.`, 409);
}

async function nextId() {
  const ids = await prisma.coupon.findMany({ select: { id: true } });
  return `c${ids.reduce((max, { id }) => Math.max(max, Number(String(id).replace(/^c/, "")) || 0), 0) + 1}`;
}

export async function createCoupon(body, actor, meta = {}) {
  const data = fields(body);
  checkValue(data);
  await assertCodeFree(data.code);
  const coupon = await prisma.coupon.create({ data: { id: await nextId(), ...data } });
  await audit(actor.id, "staff", "COUPON_CREATE", { ...meta, meta: { id: coupon.id, code: coupon.code } });
  return present(coupon);
}

export async function updateCoupon(id, body, actor, meta = {}) {
  const current = await prisma.coupon.findUnique({ where: { id } });
  if (!current) throw new ApiError("That coupon no longer exists.", 404);
  const data = fields({ ...present(current), ...body });
  checkValue(data);
  await assertCodeFree(data.code, id);
  const coupon = await prisma.coupon.update({ where: { id }, data });
  await audit(actor.id, "staff", "COUPON_UPDATE", { ...meta, meta: { id, code: coupon.code } });
  return present(coupon);
}

export async function deleteCoupon(id, actor, meta = {}) {
  const current = await prisma.coupon.findUnique({ where: { id } });
  if (!current) throw new ApiError("That coupon no longer exists.", 404);
  await prisma.coupon.delete({ where: { id } });
  await audit(actor.id, "staff", "COUPON_DELETE", { ...meta, meta: { id, code: current.code } });
  return present(current);
}

/** A seed coupon as a row. */
export function seedCoupon(c) {
  return { id: c.id, ...fields({ ...c, minOrderValue: c.minOrderValue ?? 0 }) };
}
