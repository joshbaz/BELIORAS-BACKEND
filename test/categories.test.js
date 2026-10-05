/* Category Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";
import { SEED_CATEGORIES } from "../src/features/categories/seed.js";

/**
 * Categories, once they are the server's.
 *
 * Weighted the same way as the size tests: an id cannot be changed, a spent id
 * is never handed out again, and type / subcategory ids survive a rename —
 * because each of those is a product's `collectionId`, `type` or `subcat:` tag,
 * and breaking one corrupts products silently.
 */

const PUBLIC = "/api/v1/storefront/taxonomy/categories";
const ADMIN = "/api/v1/admin/taxonomy/categories";
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
    data: {
      realm: "staff",
      name: "Seeded Staff",
      email,
      role,
      passwordHash: bcrypt.hashSync(TEMP_PASSWORD, 10),
      mustChangePassword: false,
    },
  });
  const res = await agent.post("/api/v1/admin/auth/login").send({ email, password: TEMP_PASSWORD });
  assert.equal(res.status, 200, `login failed for ${role}: ${JSON.stringify(res.body)}`);
  return `Bearer ${res.body.data.accessToken}`;
}

async function restoreList() {
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.category.deleteMany();
  await prisma.freedId.deleteMany({ where: { kind: "category" } });
  for (const row of SEED_CATEGORIES) await prisma.category.create({ data: row });
}

/** A minimal valid body, overridable. */
const body = (over = {}) => ({ name: "Shoes", sizes: [], subcategories: [], ...over });

before(async () => {
  agent = await api();
  await restoreList();
  auth.content = await tokenFor("content");
  auth.viewer = await tokenFor("viewer");
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await restoreList();
  await teardown();
});

describe("categories — reading", () => {
  it("serves the list to an anonymous shopper, in order", async () => {
    const res = await agent.get(PUBLIC);
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "public, max-age=60, stale-while-revalidate=300");
    assert.deepEqual(res.body.data.map((c) => c.id), ["dresses", "hair", "accessories"]);
    const dresses = res.body.data[0];
    assert.equal(dresses.types, undefined, "types live only inside subcategories");
    const byCategory = dresses.subcategories.find((s) => s.id === "shop-by-category");
    assert.ok(byCategory.types.some((t) => t.id === "jumpsuits"));
    assert.ok(dresses.subcategories.some((s) => s.id === "shop-by-occasion"));
  });

  it("refuses an anonymous staff read", async () => {
    assert.equal((await agent.get(ADMIN)).status, 401);
  });

  it("refuses a write from a role without edit", async () => {
    const res = await agent.post(ADMIN).set("Authorization", auth.viewer).send(body());
    assert.equal(res.status, 403);
  });

  it("is not read as a category called reset or order", async () => {
    assert.equal((await agent.get(`${ADMIN}/reset`).set("Authorization", auth.content)).status, 404);
    assert.equal((await agent.get(`${ADMIN}/order`).set("Authorization", auth.content)).status, 404);
  });
});

describe("categories — creating and updating", () => {
  it("adds a category at the end with derived ids", async () => {
    const res = await agent
      .post(ADMIN)
      .set("Authorization", auth.content)
      .send(body({ subcategories: [{ name: "Shop by Style", types: [{ name: "Heels" }, { name: "Flats" }, { name: "Ankle Boots" }] }] }));
    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, "shoes");
    assert.equal(res.body.data.position, 3);
    assert.equal(res.body.data.subcategories[0].id, "shop-by-style");
    assert.deepEqual(res.body.data.subcategories[0].types.map((t) => t.id), ["heels", "flats", "ankle-boots"]);
  });

  it("refuses a duplicate name however it is capitalised", async () => {
    const res = await agent.post(ADMIN).set("Authorization", auth.content).send(body({ name: "  dresses " }));
    assert.equal(res.status, 409);
  });

  it("refuses a name listed twice within a subcategory's types", async () => {
    const res = await agent
      .post(ADMIN)
      .set("Authorization", auth.content)
      .send(body({ name: "Bags", subcategories: [{ name: "By Shape", types: [{ name: "Tote" }, { name: "tote" }] }] }));
    assert.equal(res.status, 409);
  });

  it("refuses a flat type list on the category itself", async () => {
    const res = await agent
      .post(ADMIN)
      .set("Authorization", auth.content)
      .send(body({ name: "Bags", types: [{ name: "Tote" }] }));
    assert.equal(res.status, 400);
  });

  it("keeps type and subcategory ids across a rename, and keeps array order", async () => {
    const res = await agent
      .patch(`${ADMIN}/shoes`)
      .set("Authorization", auth.content)
      .send(
        body({
          name: "Footwear",
          subcategories: [
            {
              id: "shop-by-style",
              name: "By Style",
              types: [{ id: "flats", name: "Ballet Flats" }, { id: "ankle-boots", name: "Boots" }, { id: "heels", name: "High Heels" }],
            },
          ],
        }),
      );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, "shoes", "a rename must not change the id");
    assert.equal(res.body.data.subcategories[0].id, "shop-by-style");
    assert.equal(res.body.data.subcategories[0].name, "By Style");
    assert.deepEqual(res.body.data.subcategories[0].types, [
      { id: "flats", name: "Ballet Flats" },
      { id: "ankle-boots", name: "Boots" },
      { id: "heels", name: "High Heels" },
    ]);
  });

  it("does not let a client invent a child id", async () => {
    const res = await agent
      .patch(`${ADMIN}/shoes`)
      .set("Authorization", auth.content)
      .send(body({ name: "Footwear", subcategories: [{ id: "shop-by-style", name: "By Style", types: [{ id: "made-up", name: "Sandals" }] }] }));
    assert.equal(res.body.data.subcategories[0].types[0].id, "sandals");
  });

  it("refuses a body carrying an id or position", async () => {
    for (const extra of [{ id: "boots" }, { position: 0 }]) {
      const res = await agent.patch(`${ADMIN}/shoes`).set("Authorization", auth.content).send(body({ name: "Footwear", ...extra }));
      assert.equal(res.status, 400);
    }
  });

  it("404s an update of a category that is not there", async () => {
    const res = await agent.patch(`${ADMIN}/nope`).set("Authorization", auth.content).send(body({ name: "Nope" }));
    assert.equal(res.status, 404);
  });
});

describe("categories — ordering", () => {
  it("applies a complete new order", async () => {
    const ids = ["shoes", "accessories", "hair", "dresses"];
    const res = await agent.put(`${ADMIN}/order`).set("Authorization", auth.content).send({ ids });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((c) => c.id), ids);
    const pub = await agent.get(PUBLIC);
    assert.deepEqual(pub.body.data.map((c) => c.id), ids);
  });

  it("refuses an order that is missing, adds or repeats an id", async () => {
    for (const ids of [["shoes", "hair", "dresses"], ["shoes", "accessories", "hair", "dresses", "ghost"], ["shoes", "shoes", "hair", "dresses"]]) {
      const res = await agent.put(`${ADMIN}/order`).set("Authorization", auth.content).send({ ids });
      assert.equal(res.status, 409, `expected 409 for ${ids.join(",")}`);
    }
  });
});

describe("categories — deleting, spent ids, reset", () => {
  it("removes a category and never reissues its id", async () => {
    const del = await agent.delete(`${ADMIN}/shoes`).set("Authorization", auth.content);
    assert.equal(del.status, 200);

    const again = await agent.post(ADMIN).set("Authorization", auth.content).send(body({ name: "Shoes" }));
    assert.equal(again.status, 201);
    assert.equal(again.body.data.id, "shoes-2", "a spent id must not be reissued");
  });

  it("resets to the shipped three and spends the added ids", async () => {
    const res = await agent.post(`${ADMIN}/reset`).set("Authorization", auth.content);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((c) => c.id), ["dresses", "hair", "accessories"]);

    const again = await agent.post(ADMIN).set("Authorization", auth.content).send(body({ name: "Shoes" }));
    assert.equal(again.body.data.id, "shoes-3");
    await agent.delete(`${ADMIN}/shoes-3`).set("Authorization", auth.content);
  });

  it("records the writes in the audit log", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const actions = (await prisma.auditLog.findMany({ where: { action: { in: ["CATEGORY_CREATE", "CATEGORY_UPDATE", "CATEGORY_DELETE", "CATEGORY_REORDER", "CATEGORY_RESET"] } } })).map((r) => r.action);
    for (const a of ["CATEGORY_CREATE", "CATEGORY_UPDATE", "CATEGORY_DELETE", "CATEGORY_REORDER", "CATEGORY_RESET"]) {
      assert.ok(actions.includes(a), `${a} should be audited`);
    }
  });
});
