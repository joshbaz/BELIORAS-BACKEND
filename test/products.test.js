/* Product And Inventory Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";
import { SEED_CATEGORIES } from "../src/features/categories/seed.js";
import { SEED_COLORS } from "../src/features/colors/seed.js";
import { SEED_SIZES } from "../src/features/sizes/seed.js";

/**
 * The catalogue and its stock, once they are the server's. Weighted towards
 * what is invisible until it costs money: a shopper seeing cost price or a
 * draft, a stock change without its history, two receipts where one count
 * overwrites the other, an order shipping twice, and a piece filed under
 * something that no longer exists.
 */

const PUBLIC = "/api/v1/storefront/products";
const ADMIN = "/api/v1/admin/products";
const INV = "/api/v1/admin/inventory";
const TEMP_PASSWORD = "Temporary123";

const created = [];
let agent;
const auth = {};

async function tokenFor(role) {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  await prisma.user.create({
    data: { realm: "staff", name: `Test ${role}`, email, role, passwordHash: bcrypt.hashSync(TEMP_PASSWORD, 10), mustChangePassword: false },
  });
  const res = await agent.post("/api/v1/admin/auth/login").send({ email, password: TEMP_PASSWORD });
  assert.equal(res.status, 200, `login failed for ${role}: ${JSON.stringify(res.body)}`);
  return `Bearer ${res.body.data.accessToken}`;
}

async function reset() {
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.product.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.category.deleteMany();
  await prisma.color.deleteMany();
  await prisma.size.deleteMany();
  for (const row of SEED_CATEGORIES) await prisma.category.create({ data: row });
  for (const row of SEED_COLORS) await prisma.color.create({ data: row });
  for (const row of SEED_SIZES) await prisma.size.create({ data: row });
}

/** A valid dress, overridable. Ebony in S and M. */
const dress = (over = {}) => ({
  name: "Test Gown",
  collectionId: "dresses",
  price: 120,
  costPrice: 40,
  status: "active",
  sizes: ["s", "m"],
  colorways: [{ colorId: "ebony", images: [], stock: { s: 2, m: 3 } }],
  tags: ["subcat:shop-by-occasion:evening-dresses"],
  ...over,
});

const post = (body) => agent.post(ADMIN).set("Authorization", auth.content).send(body);
const history = async (productId) =>
  (await agent.get(`${INV}/movements`).query({ productId }).set("Authorization", auth.staff)).body.data;

before(async () => {
  agent = await api();
  await reset();
  auth.content = await tokenFor("content");
  auth.staff = await tokenFor("staff");
  auth.support = await tokenFor("support");
  auth.viewer = await tokenFor("viewer");
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.product.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.setting.deleteMany();
  await teardown();
});

describe("products — writing", () => {
  it("creates a piece with an id, an address, a stock total and its opening history", async () => {
    const res = await post(dress({ stock: 999 }));
    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, "p1");
    assert.equal(res.body.data.slug, "test-gown");
    assert.equal(res.body.data.stock, 5, "stock is the colourway total, never the client's number");

    const moves = await history("p1");
    assert.equal(moves.length, 2);
    assert.ok(moves.every((m) => m.reason === "counted" && m.note === "Opening stock" && m.by === "Test content"));
  });

  it("refuses a piece filed under something that does not exist", async () => {
    for (const bad of [
      { collectionId: "nope" },
      { colorways: [{ colorId: "nope", images: [], stock: { s: 1 } }] },
      { sizes: ["nope"] },
      { tags: ["subcat:shop-by-occasion:nope"] },
      { tags: ["tag:new"] },
    ]) {
      const res = await post(dress({ name: `Bad ${JSON.stringify(bad)}`, ...bad }));
      assert.equal(res.status, 422, `${JSON.stringify(bad)} → ${res.status}`);
    }
  });

  it("refuses a body carrying a permanent field", async () => {
    for (const extra of [{ id: "p99" }, { createdAt: "2020-01-01" }, { deletedAt: null }]) {
      assert.equal((await post(dress({ name: "Sneaky", ...extra }))).status, 400);
    }
  });

  it("re-addresses only when the name changes, and records stock edits from the form", async () => {
    const res = await agent
      .patch(`${ADMIN}/p1`)
      .set("Authorization", auth.content)
      .send({ colorways: [{ colorId: "ebony", images: [], stock: { s: 4, m: 3 } }] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.slug, "test-gown");
    assert.equal(res.body.data.stock, 7);
    const [latest] = await history("p1");
    assert.deepEqual([latest.size, latest.delta, latest.onHandAfter, latest.note], ["s", 2, 4, "Edited in the product form"]);

    const renamed = await agent.patch(`${ADMIN}/p1`).set("Authorization", auth.content).send({ name: "Velvet Gown" });
    assert.equal(renamed.body.data.slug, "velvet-gown");
  });

  it("refuses a write from a role without Products edit", async () => {
    assert.equal((await agent.post(ADMIN).set("Authorization", auth.support).send(dress())).status, 403);
  });
});

describe("products — what shoppers see", () => {
  it("lists active pieces only, without cost price", async () => {
    await post(dress({ name: "Draft Gown", status: "draft" }));
    const res = await agent.get(PUBLIC);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((p) => p.name), ["Velvet Gown"]);
    assert.equal(res.body.data[0].costPrice, undefined);

    const staff = await agent.get(ADMIN).set("Authorization", auth.content);
    assert.equal(staff.body.data.length, 2);
    assert.equal(staff.body.data.find((p) => p.name === "Velvet Gown").costPrice, 40);
  });

  it("finds a piece by slug, and 404s a draft", async () => {
    assert.equal((await agent.get(`${PUBLIC}/velvet-gown`)).body.data.id, "p1");
    assert.equal((await agent.get(`${PUBLIC}/draft-gown`)).status, 404);
  });
});

describe("products — delete and undo", () => {
  it("hides a piece, keeps its id spent, and restores it at the same address", async () => {
    assert.equal((await agent.delete(`${ADMIN}/p1`).set("Authorization", auth.content)).status, 200);
    assert.equal((await agent.get(`${PUBLIC}/velvet-gown`)).status, 404);

    const next = await post(dress({ name: "Velvet Gown" }));
    assert.equal(next.body.data.id, "p3", "a deleted id is never reissued");
    assert.equal(next.body.data.slug, "velvet-gown-2", "a deleted piece keeps its address for Undo");

    const restored = await agent.post(`${ADMIN}/p1/restore`).set("Authorization", auth.content);
    assert.equal(restored.status, 200);
    assert.equal((await agent.get(`${PUBLIC}/velvet-gown`)).body.data.id, "p1");
  });
});

describe("inventory", () => {
  it("adjusts one variant, records who and why, and refuses removing more than is there", async () => {
    const res = await agent
      .post(`${INV}/adjust`)
      .set("Authorization", auth.staff)
      .send({ productId: "p1", colorId: "ebony", size: "m", mode: "set", quantity: 10, reason: "counted", note: "Shelf count" });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.movements[0].delta, 7);
    assert.equal(res.body.data.products[0].colorways[0].stock.m, 10);
    assert.equal(res.body.data.movements[0].by, "Test staff");

    const tooMany = await agent
      .post(`${INV}/adjust`)
      .set("Authorization", auth.staff)
      .send({ productId: "p1", colorId: "ebony", size: "m", mode: "remove", quantity: 11 });
    assert.equal(tooMany.status, 409);
  });

  it("lands every receipt when several arrive at once", async () => {
    const one = () =>
      agent.post(`${INV}/receive`).set("Authorization", auth.staff).send({ variants: [{ productId: "p1", colorId: "ebony", size: "s" }], quantity: 1 });
    const results = await Promise.all([one(), one(), one(), one()]);
    assert.ok(results.every((r) => r.status === 200), results.map((r) => r.status).join(","));
    const p = (await agent.get(`${ADMIN}/p1`).set("Authorization", auth.staff)).body.data;
    assert.equal(p.colorways[0].stock.s, 8, "4 + four receipts of 1 — none lost to a race");
  });

  it("takes an order's pieces off once, and lets support do it without stock edit rights", async () => {
    const body = { orderId: "BL-1", reason: "sold", lines: [{ productId: "p1", colorId: "ebony", size: "s", quantity: 2 }] };
    const first = await agent.post(`${INV}/order-movements`).set("Authorization", auth.support).send(body);
    assert.equal(first.status, 200);
    assert.equal(first.body.data.movements[0].delta, -2);

    const again = await agent.post(`${INV}/order-movements`).set("Authorization", auth.support).send(body);
    assert.equal(again.status, 409, "an order ships once");

    const byHand = await agent
      .post(`${INV}/adjust`)
      .set("Authorization", auth.support)
      .send({ productId: "p1", colorId: "ebony", size: "s", mode: "add", quantity: 1 });
    assert.equal(byHand.status, 403, "support may move stock for orders, not by hand");
  });

  it("saves the low-stock line", async () => {
    assert.equal((await agent.get(`${INV}/settings`).set("Authorization", auth.staff)).body.data.lowStockThreshold, 3);
    const res = await agent.put(`${INV}/settings`).set("Authorization", auth.staff).send({ lowStockThreshold: 5 });
    assert.equal(res.body.data.lowStockThreshold, 5);
    assert.equal((await agent.put(`${INV}/settings`).set("Authorization", auth.staff).send({ lowStockThreshold: 1000 })).status, 400);
  });
});

describe("guards on what products use", () => {
  it("refuses deleting a category, colour or subcategory type a live piece uses", async () => {
    const cat = await agent.delete("/api/v1/admin/taxonomy/categories/dresses").set("Authorization", auth.content);
    assert.equal(cat.status, 409);
    const color = await agent.delete("/api/v1/admin/taxonomy/colors/ebony").set("Authorization", auth.content);
    assert.equal(color.status, 409);

    const { prisma } = await import("../src/db/prisma.js");
    const dresses = await prisma.category.findUnique({ where: { id: "dresses" } });
    const subcategories = dresses.subcategories.map((s) =>
      s.id === "shop-by-occasion" ? { ...s, types: s.types.filter((t) => t.id !== "evening-dresses") } : s,
    );
    const res = await agent
      .patch("/api/v1/admin/taxonomy/categories/dresses")
      .set("Authorization", auth.content)
      .send({ name: "Dresses", sizes: dresses.sizes, subcategories });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /Evening Dresses is tagged/);
  });
});

describe("products — saving from a form that was open a while", () => {
  // Its own piece (S 4, M 3), so these tests leave p1's counts to the others.
  let id;
  before(async () => {
    id = (await post(dress({ name: "Merge Gown", status: "draft", colorways: [{ colorId: "ebony", images: [], stock: { s: 4, m: 3 } }] }))).body.data.id;
  });

  it("merges stock: only edited cells move, by the editor's difference", async () => {
    const opened = (await agent.get(`${ADMIN}/${id}`).set("Authorization", auth.content)).body.data;
    const base = { colorways: { ebony: { ...opened.colorways[0].stock } } };
    assert.deepEqual(base.colorways.ebony, { s: 4, m: 3 });

    // Meanwhile: a delivery of 5 into S, and one M is written off as damaged.
    await agent.post(`${INV}/receive`).set("Authorization", auth.staff).send({ variants: [{ productId: id, colorId: "ebony", size: "s" }], quantity: 5 });
    await agent.post(`${INV}/adjust`).set("Authorization", auth.staff).send({ productId: id, colorId: "ebony", size: "m", mode: "remove", quantity: 1, reason: "damaged" });

    // The editor left S alone and typed M: 3 → 5.
    const res = await agent
      .patch(`${ADMIN}/${id}`)
      .set("Authorization", auth.content)
      .send({
        ifEditVersion: opened.editVersion,
        stockBase: base,
        colorways: [{ colorId: "ebony", images: [], stock: { s: 4, m: 5 } }],
      });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.colorways[0].stock, { s: 9, m: 4 }, "S keeps the delivery; M is 2 (after the write-off) + 2");
  });

  it("refuses a save from a form opened before someone else's save", async () => {
    const opened = (await agent.get(`${ADMIN}/${id}`).set("Authorization", auth.content)).body.data;
    await agent.patch(`${ADMIN}/${id}`).set("Authorization", auth.content).send({ ifEditVersion: opened.editVersion, description: "First" });
    const stale = await agent.patch(`${ADMIN}/${id}`).set("Authorization", auth.content).send({ ifEditVersion: opened.editVersion, description: "Second" });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error.message, /Someone else saved this piece/);
  });

  it("does not count stock moves as an edit", async () => {
    const opened = (await agent.get(`${ADMIN}/${id}`).set("Authorization", auth.content)).body.data;
    await agent.post(`${INV}/receive`).set("Authorization", auth.staff).send({ variants: [{ productId: id, colorId: "ebony", size: "s" }], quantity: 1 });
    const res = await agent.patch(`${ADMIN}/${id}`).set("Authorization", auth.content).send({ ifEditVersion: opened.editVersion, description: "After a delivery" });
    assert.equal(res.status, 200);
  });

  it("refuses a photo that only exists in one browser, with a reason", async () => {
    const res = await agent
      .patch(`${ADMIN}/${id}`)
      .set("Authorization", auth.content)
      .send({ images: ["blob:http://localhost:5173/abc"] });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Upload the photo again/);
  });
});
