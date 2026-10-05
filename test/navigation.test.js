/* Navigation Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";
import { SEED_NAVIGATION } from "../src/features/navigation/seed.js";

/**
 * The mega menu, once it is the server's. Weighted towards the two failures
 * that are invisible until a shopper hits them: a save that silently overwrote
 * someone else's (the version check), and a tree that would leave two links on
 * one address or a menu item on a page the shop already uses.
 */

const PUBLIC = "/api/v1/storefront/navigation";
const ADMIN = "/api/v1/admin/navigation";
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
    data: { realm: "staff", name: "Seeded Staff", email, role, passwordHash: bcrypt.hashSync(TEMP_PASSWORD, 10), mustChangePassword: false },
  });
  const res = await agent.post("/api/v1/admin/auth/login").send({ email, password: TEMP_PASSWORD });
  assert.equal(res.status, 200, `login failed for ${role}: ${JSON.stringify(res.body)}`);
  return `Bearer ${res.body.data.accessToken}`;
}

async function clear() {
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.navigation.deleteMany();
}

const clone = (v) => JSON.parse(JSON.stringify(v));

before(async () => {
  agent = await api();
  await clear();
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
  await clear();
  await teardown();
});

describe("navigation — reading", () => {
  it("serves the shipped menu to an anonymous shopper on a fresh database", async () => {
    const res = await agent.get(PUBLIC);
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "public, max-age=60, stale-while-revalidate=300");
    assert.deepEqual(res.body.data.items.map((r) => r.id), SEED_NAVIGATION.map((r) => r.id));
    assert.equal(res.body.data.version, 1);
  });

  it("keeps presentation fields the schema does not name", async () => {
    const res = await agent.get(PUBLIC);
    const leaf = res.body.data.items[0].sections[0].items[0];
    assert.deepEqual(leaf.aliases, SEED_NAVIGATION[0].sections[0].items[0].aliases);
  });

  it("refuses an anonymous staff read and a save without edit", async () => {
    assert.equal((await agent.get(ADMIN)).status, 401);
    const res = await agent.put(ADMIN).set("Authorization", auth.viewer).send({ items: SEED_NAVIGATION, version: 1 });
    assert.equal(res.status, 403);
  });
});

describe("navigation — saving", () => {
  it("saves the whole tree and bumps the version", async () => {
    const items = clone(SEED_NAVIGATION);
    items[0].label = "Just In";
    const res = await agent.put(ADMIN).set("Authorization", auth.content).send({ items, version: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.version, 2);
    assert.equal((await agent.get(PUBLIC)).body.data.items[0].label, "Just In");
  });

  it("refuses a save made from an older version, and keeps the newer menu", async () => {
    const items = clone(SEED_NAVIGATION);
    items[0].label = "Stale Edit";
    const res = await agent.put(ADMIN).set("Authorization", auth.content).send({ items, version: 1 });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /Someone else saved/);
    assert.equal((await agent.get(PUBLIC)).body.data.items[0].label, "Just In");
  });

  it("refuses two links on one address, with the reason as the message", async () => {
    const items = clone(SEED_NAVIGATION);
    const [a, b] = items[0].sections[0].items.length > 1 ? items[0].sections[0].items : [items[0].sections[0].items[0], items[1].sections[0].items[0]];
    b.url = a.url;
    const res = await agent.put(ADMIN).set("Authorization", auth.content).send({ items, version: 2 });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Two links use the address/);
  });

  it("refuses a menu item on an address the shop already uses", async () => {
    const items = clone(SEED_NAVIGATION);
    items[0].slug = "checkout";
    items[0].url = "/checkout";
    const res = await agent.put(ADMIN).set("Authorization", auth.content).send({ items, version: 2 });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /already uses/);
  });

  it("refuses a blank name, an empty column, and a missing version", async () => {
    const blank = clone(SEED_NAVIGATION);
    blank[0].label = " ";
    const emptyColumn = clone(SEED_NAVIGATION);
    emptyColumn[0].sections[0].items = [];
    for (const body of [{ items: blank, version: 2 }, { items: emptyColumn, version: 2 }, { items: SEED_NAVIGATION }]) {
      const res = await agent.put(ADMIN).set("Authorization", auth.content).send(body);
      assert.equal(res.status, 400);
    }
  });

  it("resets to the shipped menu and bumps the version so open editors cannot undo it", async () => {
    const res = await agent.post(`${ADMIN}/reset`).set("Authorization", auth.content);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items[0].label, SEED_NAVIGATION[0].label);
    assert.equal(res.body.data.version, 3);

    const stale = await agent.put(ADMIN).set("Authorization", auth.content).send({ items: SEED_NAVIGATION, version: 2 });
    assert.equal(stale.status, 409);
  });

  it("records saves and resets in the audit log", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const actions = new Set(
      (await prisma.auditLog.findMany({ where: { action: { in: ["NAVIGATION_UPDATE", "NAVIGATION_RESET"] } } })).map((r) => r.action),
    );
    assert.equal(actions.size, 2);
  });
});
