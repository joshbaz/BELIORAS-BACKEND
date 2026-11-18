/* November 2026 Client Request Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";
import { SEED_CATEGORIES } from "../src/features/categories/seed.js";
import { SEED_COLORS } from "../src/features/colors/seed.js";
import { SEED_SIZES } from "../src/features/sizes/seed.js";
import { RESERVED_SLUGS } from "../src/versions/v1/schemas/navigation.schema.js";
import { SEED_SIZE_GUIDES } from "../src/features/sizeGuides/seed.js";

/**
 * The server side of the 17–18 Nov 2026 storefront changes (client
 * docs/14-backend-changes-nov-2026.md): a product's manufacturer and safety
 * warnings, a fit model's usual size, the owner's address kept out of the
 * public settings while the invoice keeps her name, the two new reserved
 * addresses, and the hidden "As shown" colour that must never go away.
 */

const PASSWORD = "Temporary123";
const created = [];
let agent;
let admin;

async function signIn(role) {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  await prisma.user.create({ data: { realm: "staff", name: `Test ${role}`, email, role, passwordHash: bcrypt.hashSync(PASSWORD, 10), mustChangePassword: false } });
  const res = await agent.post("/api/v1/admin/auth/login").send({ email, password: PASSWORD });
  return `Bearer ${res.body.data.accessToken}`;
}

async function reset() {
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.product.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.fitModel.deleteMany();
  await prisma.freedId.deleteMany({ where: { kind: { in: ["model", "color"] } } });
  await prisma.category.deleteMany();
  await prisma.color.deleteMany();
  await prisma.size.deleteMany();
  for (const row of SEED_CATEGORIES) await prisma.category.create({ data: row });
  for (const row of SEED_COLORS) await prisma.color.create({ data: row });
  for (const row of SEED_SIZES) await prisma.size.create({ data: row });
}

before(async () => {
  agent = await api();
  await reset();
  admin = await signIn("super-admin");
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  await reset();
  const ids = (await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } })).map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await teardown();
});

const dress = (over = {}) => ({
  name: "Safety Gown",
  collectionId: "dresses",
  price: 120,
  costPrice: 40,
  status: "active",
  sizes: ["s", "m"],
  colorways: [{ colorId: "ebony", images: [], stock: { s: 2, m: 3 } }],
  ...over,
});

describe("product manufacturer and safety warnings", () => {
  it("saves them, returns them to shoppers, and clears the manufacturer with null", async () => {
    const manufacturer = { name: "Atelier Rossi", address: "Via Roma 1, 20121 Milano, Italy", contact: "info@rossi.example" };
    const res = await agent
      .post("/api/v1/admin/products")
      .set("Authorization", admin)
      .send(dress({ manufacturer, safetyWarnings: ["Keep away from open flames."] }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { id } = res.body.data;

    const shop = (await agent.get("/api/v1/storefront/products")).body.data.find((p) => p.id === id);
    assert.deepEqual(shop.manufacturer, manufacturer);
    assert.deepEqual(shop.safetyWarnings, ["Keep away from open flames."]);

    const cleared = await agent.patch(`/api/v1/admin/products/${id}`).set("Authorization", admin).send({ manufacturer: null, safetyWarnings: [] });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.data.manufacturer, null);
    assert.deepEqual(cleared.body.data.safetyWarnings, []);
  });

  it("accepts the form's empty save (no manufacturer, no warnings)", async () => {
    const res = await agent.post("/api/v1/admin/products").set("Authorization", admin).send(dress({ name: "Plain Gown", manufacturer: null, safetyWarnings: [] }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it("keeps photos in the order they were saved", async () => {
    const images = ["/api/uploads/c.jpg", "/api/uploads/a.jpg", "/api/uploads/b.jpg"];
    const res = await agent
      .post("/api/v1/admin/products")
      .set("Authorization", admin)
      .send(dress({ name: "Ordered Gown", colorways: [{ colorId: "ebony", images, stock: { s: 1, m: 1 } }] }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const shop = (await agent.get("/api/v1/storefront/products")).body.data.find((p) => p.id === res.body.data.id);
    assert.deepEqual(shop.colorways[0].images, images);
  });
});

describe("fit model usual size", () => {
  it("stores the size, returns it to shoppers, and clears it with null", async () => {
    const res = await agent.post("/api/v1/admin/models").set("Authorization", admin).send({ name: "Amara", heightCm: 175, size: "S" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.size, "s");
    const shop = (await agent.get("/api/v1/storefront/models")).body.data.find((m) => m.id === "amara");
    assert.equal(shop.size, "s");
    const cleared = await agent.patch("/api/v1/admin/models/amara").set("Authorization", admin).send({ name: "Amara", size: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.size, null);
  });

  it("refuses a size the shop does not sell", async () => {
    const res = await agent.post("/api/v1/admin/models").set("Authorization", admin).send({ name: "Bea", size: "xxxxl" });
    assert.equal(res.status, 422);
  });
});

describe("owner's details in settings", () => {
  it("keeps postal addresses out of the public settings, but not the staff settings", async () => {
    const shop = (await agent.get("/api/v1/storefront/settings")).body.data;
    assert.equal(shop.contact.boutique, undefined);
    assert.equal(shop.contact.boutiqueParts, undefined);
    assert.equal(shop.gpsr.address, undefined);
    assert.equal(shop.gpsr.addressParts, undefined);
    assert.ok(shop.contact.support && shop.gpsr.email);
    assert.doesNotMatch(JSON.stringify(shop), /Ongessa|Kurt-Schumacher/);

    const staff = (await agent.get("/api/v1/admin/settings").set("Authorization", admin)).body.data;
    assert.match(staff.gpsr.address, /Kurt-Schumacher/);
    assert.match(staff.invoice.sellerName, /Ongessa/);
  });

  it("moves the owner's name to the invoice for settings saved before, and only once", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const { getStoreSettings } = await import("../src/features/settings/settings.service.js");
    const old = "Belioras – Online Boutique (Belindah Ongessa)";
    const value = await getStoreSettings();
    const { sellerName: _s, ...invoice } = value.invoice;
    await prisma.setting.update({ where: { id: "store" }, data: { value: { ...value, invoice, gpsr: { ...value.gpsr, manufacturer: old } } } });

    const upgraded = await getStoreSettings();
    assert.equal(upgraded.invoice.sellerName, old);
    assert.equal(upgraded.gpsr.manufacturer, "Belioras – Online Boutique");

    // A seller name staff chose themselves is left alone.
    await prisma.setting.update({ where: { id: "store" }, data: { value: { ...upgraded, gpsr: { ...upgraded.gpsr, manufacturer: old } } } });
    assert.equal((await getStoreSettings()).gpsr.manufacturer, old);
  });
});

describe("reserved addresses and the dead guide image", () => {
  it("reserves /impressum and /size-guide for the storefront", () => {
    assert.ok(RESERVED_SLUGS.has("impressum"));
    assert.ok(RESERVED_SLUGS.has("size-guide"));
  });

  it("no longer ships the broken garment image", () => {
    assert.equal(SEED_SIZE_GUIDES.garment.garmentImage, "");
  });
});

describe("the hidden As shown colour", () => {
  const ADMIN = "/api/v1/admin/taxonomy/colors";

  before(async () => {
    const res = await agent.post(ADMIN).set("Authorization", admin).send({ name: "As shown", hex: "#C9C4CE", family: "metallic" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.id, "as-shown");
  });

  it("cannot be deleted or renamed", async () => {
    assert.equal((await agent.delete(`${ADMIN}/as-shown`).set("Authorization", admin)).status, 409);
    const renamed = await agent.patch(`${ADMIN}/as-shown`).set("Authorization", admin).send({ name: "Natural", hex: "#C9C4CE", family: "metallic" });
    assert.equal(renamed.status, 409);
  });

  it("survives a reset of the colour list", async () => {
    assert.equal((await agent.post(`${ADMIN}/reset`).set("Authorization", admin)).status, 200);
    const list = (await agent.get(ADMIN).set("Authorization", admin)).body.data;
    assert.ok(list.some((c) => c.id === "as-shown"));
  });
});
