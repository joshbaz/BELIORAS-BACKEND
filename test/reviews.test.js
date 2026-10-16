/* Review Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";

/**
 * Reviews: nothing a shopper writes shows until a moderator publishes it,
 * "verified" comes from the reviewer's real orders, and a product's stars
 * count published reviews only.
 */

const SHOP = "/api/v1/storefront";
const ADMIN = "/api/v1/admin";
const PASSWORD = "Temporary123";
const created = [];
let agent;
const auth = {};

async function tokenFor(role, realm = "staff") {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  const user = await prisma.user.create({ data: { realm, name: `Test ${role}`, email, role, passwordHash: bcrypt.hashSync(PASSWORD, 10), mustChangePassword: false } });
  const res = await agent.post(`/api/v1/${realm === "staff" ? "admin" : "storefront"}/auth/login`).send({ email, password: PASSWORD });
  return { header: `Bearer ${res.body.data.accessToken}`, id: user.id };
}

before(async () => {
  agent = await api();
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.review.deleteMany();
  await prisma.counter.deleteMany({ where: { id: "review" } });
  await prisma.product.deleteMany({ where: { id: "rv1" } });
  await prisma.product.create({ data: { id: "rv1", slug: "review-piece", name: "Review Piece", status: "active", collectionId: "dresses", price: 50, stock: 1, sizes: [], tags: [], attributes: {}, deletedAt: null } });
  auth.content = await tokenFor("content");
  auth.finance = await tokenFor("finance");
  auth.buyer = await tokenFor("customer", "customer");
  await prisma.order.create({
    data: { id: "ORD-RV1", userId: auth.buyer.id, email: "buyer@example.com", items: [{ productId: "rv1", quantity: 1, price: 50 }], subtotal: 50, discount: 0, shipping: 0, tax: 0, total: 50, status: "to-review", creditNotes: [] },
  });
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.review.deleteMany();
  await prisma.order.deleteMany({ where: { id: "ORD-RV1" } });
  await prisma.product.deleteMany({ where: { id: "rv1" } });
  await teardown();
});

describe("reviews", () => {
  let id;

  it("keeps a new review pending and out of the shop, and marks a real buyer verified", async () => {
    const res = await agent.post(`${SHOP}/reviews`).set("Authorization", auth.buyer.header).send({ productId: "rv1", rating: 4, body: "Lovely drape.", verified: true });
    assert.equal(res.status, 400, "the browser cannot claim verified");
    const ok = await agent.post(`${SHOP}/reviews`).set("Authorization", auth.buyer.header).send({ productId: "rv1", rating: 4, body: "Lovely drape." });
    assert.equal(ok.status, 201);
    assert.deepEqual([ok.body.data.status, ok.body.data.verified], ["pending", true]);
    id = ok.body.data.id;

    const guest = await agent.post(`${SHOP}/reviews`).send({ productId: "rv1", rating: 2, body: "Never bought it." });
    assert.equal(guest.body.data.verified, false);

    assert.deepEqual((await agent.get(`${SHOP}/reviews`).query({ productId: "rv1" })).body.data, []);
    const piece = (await agent.get(`${SHOP}/products/review-piece`)).body.data;
    assert.deepEqual([piece.rating, piece.reviewCount], [0, 0]);
  });

  it("publishes, replies and hides for moderators only, and the stars follow", async () => {
    assert.equal((await agent.post(`${ADMIN}/reviews/${id}/publish`).set("Authorization", auth.finance.header)).status, 403);
    assert.equal((await agent.post(`${ADMIN}/reviews/${id}/publish`).set("Authorization", auth.content.header)).status, 200);
    await agent.put(`${ADMIN}/reviews/${id}/reply`).set("Authorization", auth.content.header).send({ text: "Thank you!" });

    const shown = (await agent.get(`${SHOP}/reviews`).query({ productId: "rv1" })).body.data;
    assert.deepEqual([shown.length, shown[0].reply.text], [1, "Thank you!"]);
    const piece = (await agent.get(`${SHOP}/products/review-piece`)).body.data;
    assert.deepEqual([piece.rating, piece.reviewCount], [4, 1]);

    await agent.post(`${ADMIN}/reviews/${id}/hide`).set("Authorization", auth.content.header);
    assert.deepEqual((await agent.get(`${SHOP}/reviews`).query({ productId: "rv1" })).body.data, []);
  });
});
