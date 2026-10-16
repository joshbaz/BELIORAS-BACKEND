/* Order Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";
import { SEED_CATEGORIES } from "../src/features/categories/seed.js";
import { SEED_COLORS } from "../src/features/colors/seed.js";
import { SEED_SIZES } from "../src/features/sizes/seed.js";

/**
 * Orders, once they are the server's. Weighted towards what costs money or
 * trust: charging a price the browser made up, selling the last piece twice,
 * a reused or skipped invoice number, a stranger reading an order, stock that
 * does not follow shipping and refunds, and paying without paying.
 */

const SHOP = "/api/v1/storefront";
const ADMIN = "/api/v1/admin";
const TEMP_PASSWORD = "Temporary123";
const created = [];
let agent;
const auth = {};

async function tokenFor(role, realm = "staff") {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  await prisma.user.create({
    data: { realm, name: `Test ${role}`, email, role, passwordHash: bcrypt.hashSync(TEMP_PASSWORD, 10), mustChangePassword: false },
  });
  const res = await agent.post(`/api/v1/${realm === "staff" ? "admin" : "storefront"}/auth/login`).send({ email, password: TEMP_PASSWORD });
  assert.equal(res.status, 200, `login failed for ${role}: ${JSON.stringify(res.body)}`);
  return { header: `Bearer ${res.body.data.accessToken}`, email };
}

async function reset() {
  const { prisma } = await import("../src/db/prisma.js");
  for (const model of ["order", "transaction", "coupon", "email", "counter", "product", "stockMovement", "setting", "category", "color", "size"]) {
    await prisma[model].deleteMany();
  }
  for (const row of SEED_CATEGORIES) await prisma.category.create({ data: row });
  for (const row of SEED_COLORS) await prisma.color.create({ data: row });
  for (const row of SEED_SIZES) await prisma.size.create({ data: row });
  // One gown: Ebony in S (2) and M (1). €100.
  await prisma.product.create({
    data: {
      id: "g1", slug: "gown", name: "Gown", status: "active", collectionId: "dresses", price: 100, stock: 3,
      sizes: ["s", "m"], tags: [], colorways: [{ colorId: "ebony", images: ["/img/gown.jpg"], stock: { s: 2, m: 1 } }],
      attributes: { costPrice: 30 }, deletedAt: null,
    },
  });
  await prisma.coupon.create({ data: { id: "c1", code: "TEN", type: "percent", value: 10, maxUses: 1 } });
}

/** A Germany order (free shipping, 19% VAT inside) for one gown. */
const order = (over = {}) => ({
  email: "shopper@example.com",
  name: "Shopper",
  items: [{ productId: "g1", quantity: 1, size: "s", color: "Ebony" }],
  country: "Germany",
  shippingAddress: "Hauptstr. 1, Berlin, 10115, Germany",
  ...over,
});

const placeAndPay = async (body = order()) => {
  const placed = await agent.post(`${SHOP}/checkout`).send(body);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const paid = await agent.post(`${SHOP}/checkout/${placed.body.data.id}/simulate-payment`).send({ email: body.email });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  return paid.body.data;
};

before(async () => {
  agent = await api();
  await reset();
  auth.staff = await tokenFor("staff");
  auth.support = await tokenFor("support");
  auth.content = await tokenFor("content");
  auth.customer = await tokenFor("customer", "customer");
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  for (const model of ["order", "transaction", "coupon", "email", "counter", "product", "stockMovement", "setting"]) await prisma[model].deleteMany();
  await teardown();
});

describe("checkout — the server sets the price", () => {
  it("prices from the catalogue, snapshots the line, and holds the stock", async () => {
    const res = await agent.post(`${SHOP}/checkout`).send(order({ expectedTotal: 100 }));
    assert.equal(res.status, 201);
    const o = res.body.data;
    assert.equal(o.id, "ORD-1001");
    assert.equal(o.status, "to-pay");
    assert.deepEqual([o.subtotal, o.shipping, o.total, o.tax], [100, 0, 100, 15.97]);
    assert.deepEqual(
      { price: o.items[0].price, colorId: o.items[0].colorId, image: o.items[0].image, slug: o.items[0].slug },
      { price: 100, colorId: "ebony", image: "/img/gown.jpg", slug: "gown" },
    );
    const shop = (await agent.get(`${SHOP}/products/gown`)).body.data;
    assert.equal(shop.colorways[0].stock.s, 1, "one S is now held: shoppers see 1 available");
  });

  it("refuses a body carrying a price, and refuses a total the shopper was not shown", async () => {
    const priced = await agent.post(`${SHOP}/checkout`).send(order({ items: [{ productId: "g1", quantity: 1, size: "m", color: "Ebony", price: 1 }] }));
    assert.equal(priced.status, 400);
    const stale = await agent.post(`${SHOP}/checkout`).send(order({ items: [{ productId: "g1", quantity: 1, size: "m", color: "Ebony" }], expectedTotal: 80 }));
    assert.equal(stale.status, 409);
    assert.match(stale.body.error.message, /total has changed/);
  });

  it("charges EU shipping under the threshold, and refuses a country it does not ship to", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const eu = await agent.post(`${SHOP}/checkout`).send(order({ items: [{ productId: "g1", quantity: 1, size: "m", color: "Ebony" }], country: "France" }));
    assert.equal(eu.status, 201, JSON.stringify(eu.body));
    assert.equal(eu.body.data.shipping, 9.99);
    assert.equal(eu.body.data.total, 109.99);
    await prisma.order.update({ where: { id: eu.body.data.id }, data: { status: "cancelled" } });

    const nowhere = await agent.post(`${SHOP}/checkout`).send(order({ country: "Atlantis" }));
    assert.equal(nowhere.status, 422);
  });

  it("never sells the last piece twice, however many ask at once", async () => {
    // One M is on the shelf; five shoppers try to buy it at the same moment.
    const tries = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        agent.post(`${SHOP}/checkout`).send(order({ email: `racer${i}@example.com`, items: [{ productId: "g1", quantity: 1, size: "m", color: "Ebony" }] })),
      ),
    );
    const won = tries.filter((r) => r.status === 201);
    assert.equal(won.length, 1, tries.map((r) => `${r.status}`).join(","));
    assert.ok(tries.filter((r) => r.status === 409).every((r) => /sold out/.test(r.body.error.message)));
    const { prisma } = await import("../src/db/prisma.js");
    await prisma.order.update({ where: { id: won[0].body.data.id }, data: { status: "cancelled" } });
  });

  it("applies a coupon once, and refuses it when its last use is taken", async () => {
    const first = await agent.post(`${SHOP}/checkout`).send(order({ email: "c1@example.com", items: [{ productId: "g1", quantity: 1, size: "m", color: "Ebony" }], couponCode: "ten" }));
    assert.equal(first.status, 201);
    assert.deepEqual([first.body.data.discount, first.body.data.total, first.body.data.couponCode], [10, 90, "TEN"]);
    const second = await agent.post(`${SHOP}/coupons/validate`).send({ code: "TEN", subtotal: 100 });
    assert.equal(second.status, 410);
    const { prisma } = await import("../src/db/prisma.js");
    await prisma.order.update({ where: { id: first.body.data.id }, data: { status: "cancelled" } });
    assert.equal((await agent.post(`${SHOP}/coupons/validate`).send({ code: "TEN", subtotal: 100 })).status, 200, "a cancelled order hands its use back");
  });
});

describe("payment, access and invoices", () => {
  it("marks paid only through the payment step, with an invoice number in sequence and a confirmation queued", async () => {
    const a = await placeAndPay(order({ email: "inv1@example.com", items: [{ productId: "g1", quantity: 1, size: "m", color: "Ebony" }] }));
    assert.equal(a.status, "to-ship");
    const year = new Date().getFullYear();
    assert.equal(a.invoiceNumber, `BEL-${year}-0001`);

    const forHand = await agent.post(`${ADMIN}/orders/${a.id}/status`).set("Authorization", auth.staff.header).send({ status: "to-ship" });
    assert.equal(forHand.status, 409, "staff never mark an order paid");

    const emails = (await agent.get(`${ADMIN}/emails`).query({ orderId: a.id }).set("Authorization", auth.staff.header)).body.data;
    assert.ok(emails.some((e) => e.type === "order-confirmation"));
    const txns = (await agent.get(`${ADMIN}/transactions`).query({ orderId: a.id }).set("Authorization", auth.staff.header)).body.data;
    assert.equal(txns[0].type, "charge");
    assert.equal(txns[0].amount, 100);
  });

  it("shows an order to its owner, by email or account, and to nobody else", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const id = (await prisma.order.findFirst({ where: { email: "inv1@example.com" } })).id;
    assert.equal((await agent.get(`${SHOP}/orders/${id}`).query({ email: "INV1@example.com" })).status, 200);
    assert.equal((await agent.get(`${SHOP}/orders/${id}`).query({ email: "someone@else.com" })).status, 404);
    assert.equal((await agent.get(`${SHOP}/orders/${id}`)).status, 404);
    assert.equal((await agent.get(`${SHOP}/orders/ORD-9999`).query({ email: "inv1@example.com" })).status, 404);

    const mine = await agent.post(`${SHOP}/checkout`).set("Authorization", auth.customer.header).send(order({ email: "ignored@example.com", items: [{ productId: "g1", quantity: 1, size: "s", color: "Ebony" }] }));
    assert.equal(mine.body.data.email, auth.customer.email.toLowerCase(), "a signed-in shopper's order is theirs");
    const list = (await agent.get(`${SHOP}/orders`).set("Authorization", auth.customer.header)).body.data;
    assert.deepEqual(list.map((o) => o.id), [mine.body.data.id]);
    await agent.post(`${SHOP}/orders/${mine.body.data.id}/cancel`).set("Authorization", auth.customer.header).send({});
  });

  it("prints an invoice for its owner", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const id = (await prisma.order.findFirst({ where: { email: "inv1@example.com" } })).id;
    const res = await agent.get(`${SHOP}/orders/${id}/invoice`).query({ email: "inv1@example.com" });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.kind, "invoice");
    assert.equal(res.body.data.totals.gross, 100);
  });

  it("refuses the payment stand-in where payments are real", async () => {
    const { env } = await import("../src/config/index.js");
    const before = env.PAYMENTS_SIMULATED;
    env.PAYMENTS_SIMULATED = "false";
    try {
      const placed = await agent.post(`${SHOP}/checkout`).send(order({ email: "real@example.com" }));
      const res = await agent.post(`${SHOP}/checkout/${placed.body.data.id}/simulate-payment`).send({ email: "real@example.com" });
      assert.equal(res.status, 403);
      await agent.post(`${SHOP}/orders/${placed.body.data.id}/cancel`).send({ email: "real@example.com" });
    } finally {
      env.PAYMENTS_SIMULATED = before;
    }
  });
});

describe("after payment — stock and money follow the order", () => {
  let id;
  before(async () => {
    const { prisma } = await import("../src/db/prisma.js");
    await prisma.product.update({ where: { id: "g1" }, data: { colorways: [{ colorId: "ebony", images: [], stock: { s: 5, m: 5 } }], stock: 10 } });
    id = (await placeAndPay(order({ email: "ship@example.com", items: [{ productId: "g1", quantity: 2, size: "s", color: "Ebony" }] }))).id;
  });

  const onHand = async () => (await agent.get(`${ADMIN}/products/g1`).set("Authorization", auth.staff.header)).body.data.colorways[0].stock.s;

  it("takes the pieces off the shelf when it ships, once, and only for roles that handle orders", async () => {
    const before = await onHand();
    assert.equal((await agent.post(`${ADMIN}/orders/${id}/status`).set("Authorization", auth.content.header).send({ status: "shipped" })).status, 403);
    const res = await agent.post(`${ADMIN}/orders/${id}/status`).set("Authorization", auth.support.header).send({ status: "shipped", carrier: "DHL", trackingRef: "JD1" });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.stockDeductedAt);
    assert.equal(await onHand(), before - 2);
  });

  it("refunds a line with a credit note and puts it back on the shelf", async () => {
    const before = await onHand();
    const res = await agent
      .post(`${ADMIN}/orders/${id}/refund`)
      .set("Authorization", auth.staff.header)
      .send({ lines: [{ index: 0, quantity: 1 }], restock: true, reason: "Too small" });
    assert.equal(res.status, 200);
    const year = new Date().getFullYear();
    assert.equal(res.body.data.creditNote.number, `BEL-CN-${year}-0001`);
    assert.equal(res.body.data.creditNote.amount, 100);
    assert.equal(res.body.data.order.status, "shipped", "half refunded: still open");
    assert.equal(await onHand(), before + 1);

    const over = await agent.post(`${ADMIN}/orders/${id}/refund`).set("Authorization", auth.staff.header).send({ amount: 500 });
    assert.equal(over.status, 422);
  });

  it("closes as refunded when nothing is left to give back", async () => {
    const res = await agent.post(`${ADMIN}/orders/${id}/refund`).set("Authorization", auth.staff.header).send({ lines: [{ index: 0, quantity: 1 }] });
    assert.equal(res.body.data.order.status, "refunded");
    assert.equal(res.body.data.creditNote.number, `BEL-CN-${new Date().getFullYear()}-0002`);
  });

  it("ranks best sellers without counting refunded orders", async () => {
    const res = await agent.get(`${SHOP}/rankings/best-sellers`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.every((r) => typeof r.productId === "string" && typeof r.units === "number"));
  });
});

describe("unpaid orders lapse", () => {
  it("stops holding stock after the payment window, refuses a late payment, and the sweep cancels it", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    await prisma.product.update({ where: { id: "g1" }, data: { colorways: [{ colorId: "ebony", images: [], stock: { s: 1, m: 0 } }], stock: 1 } });
    await prisma.order.updateMany({ where: { status: { in: ["to-pay", "to-ship"] } }, data: { status: "cancelled" } });

    const placed = await agent.post(`${SHOP}/checkout`).send(order({ email: "late@example.com" }));
    assert.equal(placed.status, 201);
    assert.equal((await agent.get(`${SHOP}/products/gown`)).body.data.colorways[0].stock.s, 0, "held while it can still be paid");

    // Forty minutes later, still unpaid.
    await prisma.order.update({ where: { id: placed.body.data.id }, data: { createdAt: new Date(Date.now() - 40 * 60_000) } });
    assert.equal((await agent.get(`${SHOP}/products/gown`)).body.data.colorways[0].stock.s, 1, "the hold lapsed: back on sale");

    const late = await agent.post(`${SHOP}/checkout/${placed.body.data.id}/simulate-payment`).send({ email: "late@example.com" });
    assert.equal(late.status, 409);
    assert.match(late.body.error.message, /wasn't paid in time/);

    const { expireUnpaidOrders } = await import("../src/features/orders/orders.service.js");
    assert.deepEqual(await expireUnpaidOrders(), [placed.body.data.id]);
    const after = await prisma.order.findUnique({ where: { id: placed.body.data.id } });
    assert.equal(after.status, "cancelled");
    assert.ok(await prisma.email.findFirst({ where: { orderId: placed.body.data.id, type: "order-cancelled" } }));
  });
});

describe("store settings", () => {
  it("serves settings to the shop and lets only administrators change them", async () => {
    const res = await agent.get(`${SHOP}/settings`);
    assert.equal(res.body.data.tax.rate, 0.19);
    assert.equal((await agent.patch(`${ADMIN}/settings`).set("Authorization", auth.staff.header).send({ tax: { rate: 0.2 } })).status, 403);
  });
});
