/* Review Service */

import { readFileSync } from "node:fs";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit } from "../audit/audit.js";
import { nextValue } from "../orders/counters.js";

/**
 * Reviews. A shopper's submission lands `pending`, so the storefront — which
 * only ever reads `published` — shows nothing until a moderator says so.
 * "Verified" is decided here, from the reviewer's own orders, never taken from
 * the browser.
 */

export const SEED_REVIEWS = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8"));

function present(r) {
  const { createdAt, updatedAt, userId, ...rest } = r;
  return rest;
}

const newestFirst = [{ date: "desc" }, { createdAt: "desc" }];

/** Published reviews, newest first: one product's, or the most recent across the shop. */
export async function listPublished({ productId, limit } = {}) {
  const rows = await prisma.review.findMany({
    where: { status: "published", ...(productId ? { productId } : {}) },
    orderBy: newestFirst,
    ...(limit ? { take: limit } : {}),
  });
  return rows.map(present);
}

/** Every review, every status, for the moderation queue. */
export async function listAll() {
  return (await prisma.review.findMany({ orderBy: newestFirst })).map(present);
}

/** `{ rating, reviewCount }` per product id, from published reviews only. */
export async function ratingSummaries(productIds = null) {
  const rows = await prisma.review.findMany({
    where: { status: "published", ...(productIds ? { productId: { in: productIds } } : {}) },
    select: { productId: true, rating: true },
  });
  const sums = new Map();
  for (const { productId, rating } of rows) {
    const s = sums.get(productId) ?? { total: 0, count: 0 };
    s.total += rating;
    s.count += 1;
    sums.set(productId, s);
  }
  return new Map([...sums].map(([id, s]) => [id, { rating: Math.round((s.total / s.count) * 10) / 10, reviewCount: s.count }]));
}

async function nextId(db) {
  const n = await nextValue(db, "review", async () => {
    const rows = await db.review.findMany({ select: { id: true } });
    return rows.reduce((max, r) => Math.max(max, Number(String(r.id).replace(/^r/, "")) || 0), 0);
  });
  return `r${n}`;
}

/** A shopper's review, pending until published. `customer` is the signed-in shopper or null. */
export async function createReview({ productId, rating, title, body, name }, customer) {
  const product = await prisma.product.findFirst({ where: { id: productId, status: "active" }, select: { id: true, deletedAt: true } });
  if (!product || product.deletedAt) throw new ApiError("That piece is no longer available to review.", 404);

  let verified = false;
  if (customer) {
    const orders = await prisma.order.findMany({ where: { userId: customer.id, status: { notIn: ["to-pay", "cancelled"] } }, select: { items: true } });
    verified = orders.some((o) => (o.items ?? []).some((line) => line.productId === productId));
  }

  const review = await prisma.review.create({
    data: {
      id: await nextId(prisma),
      productId,
      userId: customer?.id ?? null,
      name: (name ?? customer?.name ?? "").trim() || "Anonymous",
      rating,
      title: (title ?? "").trim(),
      body: body.trim(),
      verified,
      status: "pending",
      date: new Date().toISOString().slice(0, 10),
    },
  });
  return present(review);
}

async function setStatus(id, status, action, actor, meta) {
  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) throw new ApiError("That review no longer exists.", 404);
  const review = await prisma.review.update({ where: { id }, data: { status } });
  await audit(actor.id, "staff", action, { ...meta, meta: { id, productId: review.productId } });
  return present(review);
}

export const publishReview = (id, actor, meta = {}) => setStatus(id, "published", "REVIEW_PUBLISH", actor, meta);
export const hideReview = (id, actor, meta = {}) => setStatus(id, "hidden", "REVIEW_HIDE", actor, meta);

/** The shop's public answer under a review. Empty text removes it. */
export async function replyToReview(id, text, actor, meta = {}) {
  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) throw new ApiError("That review no longer exists.", 404);
  const trimmed = (text ?? "").trim();
  const review = await prisma.review.update({ where: { id }, data: { reply: trimmed ? { text: trimmed, at: new Date().toISOString() } : null } });
  await audit(actor.id, "staff", "REVIEW_REPLY", { ...meta, meta: { id } });
  return present(review);
}

export function seedReview(r) {
  return {
    id: r.id, productId: r.productId, userId: null, name: r.name, rating: r.rating, title: r.title ?? "",
    body: r.body, verified: Boolean(r.verified), status: r.status ?? "published", reply: r.reply ?? undefined,
    date: r.date ?? new Date().toISOString().slice(0, 10),
  };
}
