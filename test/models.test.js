/* Fit Model And Colour Family Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";

/**
 * Fit models and colour families, now the server's: shoppers can read them,
 * a model on a product cannot be deleted and its id is never reused, a
 * product cannot name a model that does not exist, and a colour cannot sit in
 * a family that does not exist.
 */

const PASSWORD = "Temporary123";
const created = [];
let agent;
let editor;
let viewer;

async function signIn(role) {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  await prisma.user.create({ data: { realm: "staff", name: `Test ${role}`, email, role, passwordHash: bcrypt.hashSync(PASSWORD, 10), mustChangePassword: false } });
  const res = await agent.post("/api/v1/admin/auth/login").send({ email, password: PASSWORD });
  return `Bearer ${res.body.data.accessToken}`;
}

before(async () => {
  agent = await api();
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.fitModel.deleteMany();
  await prisma.freedId.deleteMany({ where: { kind: "model" } });
  await prisma.setting.deleteMany({ where: { id: "taxonomy:color" } });
  editor = await signIn("content");
  viewer = await signIn("finance");
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: "fm1" } });
  await prisma.fitModel.deleteMany();
  await prisma.freedId.deleteMany({ where: { kind: "model" } });
  await prisma.setting.deleteMany({ where: { id: "taxonomy:color" } });
  await teardown();
});

describe("fit models", () => {
  it("adds a model for editors of Sizes only, and shows her to shoppers", async () => {
    assert.equal((await agent.post("/api/v1/admin/models").set("Authorization", viewer).send({ name: "Amara" })).status, 403);
    const res = await agent.post("/api/v1/admin/models").set("Authorization", editor).send({ name: "Amara", heightCm: 175, photo: "/api/uploads/a.jpg" });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, "amara");
    const shop = await agent.get("/api/v1/storefront/models");
    assert.equal(shop.body.data[0].heightCm, 175);
    const bad = await agent.post("/api/v1/admin/models").set("Authorization", editor).send({ name: "X", heightCm: 300 });
    assert.equal(bad.status, 400);
  });

  it("refuses deleting a model a product wears, and never reuses a deleted id", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    await prisma.product.create({
      data: { id: "fm1", slug: "fm-piece", name: "Worn Piece", status: "active", collectionId: "dresses", price: 10, stock: 1, sizes: [], tags: [], attributes: { modelFit: { modelId: "amara", size: "s" } }, deletedAt: null },
    });
    const blocked = await agent.delete("/api/v1/admin/models/amara").set("Authorization", editor);
    assert.equal(blocked.status, 409);
    await prisma.product.update({ where: { id: "fm1" }, data: { attributes: {} } });
    assert.equal((await agent.delete("/api/v1/admin/models/amara").set("Authorization", editor)).status, 200);
    const again = await agent.post("/api/v1/admin/models").set("Authorization", editor).send({ name: "Amara" });
    assert.equal(again.body.data.id, "amara-2");
  });
});

describe("colour families", () => {
  it("serves the families, and refuses a colour in one that does not exist", async () => {
    const families = (await agent.get("/api/v1/storefront/taxonomy/colors/families")).body.data;
    assert.ok(families.values.some((f) => f.id === "black"));
    const res = await agent.post("/api/v1/admin/taxonomy/colors").set("Authorization", editor).send({ name: "Moonlight", hex: "#222222", family: "no-such-family" });
    assert.equal(res.status, 422);
  });

  it("refuses removing a family a colour still uses", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    await prisma.color.upsert({ where: { id: "fam-probe" }, create: { id: "fam-probe", name: "Probe", hex: "#000000", family: "black" }, update: {} });
    const { values } = (await agent.get("/api/v1/storefront/taxonomy/colors/families")).body.data;
    const res = await agent
      .put("/api/v1/admin/taxonomy/colors/families")
      .set("Authorization", editor)
      .send({ values: values.filter((f) => f.id !== "black") });
    assert.equal(res.status, 409);
    await prisma.color.delete({ where: { id: "fam-probe" } });
  });
});
