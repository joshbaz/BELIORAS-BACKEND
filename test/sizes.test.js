/* Size List Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";
import { SEED_SIZES } from "../src/features/sizes/seed.js";

/**
 * The size list, once it is the server's.
 *
 * Weighted towards the rules that are easy to break and expensive to notice
 * having broken: that an id cannot be changed, that a spent id cannot be handed
 * out again, and that a rename cannot smuggle anything else through in the body.
 *
 * The last of those is the subtle one. A `PATCH` that quietly ignored a
 * re-pointed `id` would return 200, the dashboard would show the new name, and
 * every product still holding that id in its stock object would now be
 * describing a size that no longer means what it meant — with nothing in any
 * log to say so.
 *
 * Seeds its own staff rather than leaning on another test file, and restores the
 * shared list on the way out, since the reset test would otherwise hand the next
 * file an edited one.
 */

const PUBLIC = "/api/v1/storefront/taxonomy/sizes";
const ADMIN = "/api/v1/admin/taxonomy/sizes";
const TEMP_PASSWORD = "Temporary123";

const created = [];

/** The supertest agent. `api()` is async, so it has to be awaited before it can make a request. */
let agent;

async function seedStaff(role) {
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
  return email;
}

async function tokenFor(role) {
  const email = await seedStaff(role);
  const res = await agent.post("/api/v1/admin/auth/login").send({ email, password: TEMP_PASSWORD });
  assert.equal(res.status, 200, `login failed for ${role}: ${JSON.stringify(res.body)}`);
  return `Bearer ${res.body.data.accessToken}`;
}

const ids = {};

/** The list as stored, straight from Prisma — for asserting what a write really did. */
async function stored() {
  const { prisma } = await import("../src/db/prisma.js");
  const rows = await prisma.size.findMany();
  return [...rows].sort((a, b) => a.position - b.position);
}

/** Back to the shipped twelve, with nothing marked spent. */
async function restoreList() {
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.size.deleteMany();
  await prisma.freedId.deleteMany({ where: { kind: "size" } });
  for (const row of SEED_SIZES) await prisma.size.create({ data: row });
}

before(async () => {
  agent = await api();
  await restoreList();
  ids.content = await tokenFor("content");
  ids.staff = await tokenFor("staff");
  ids.customer = await tokenFor("super-admin");
  ids.viewer = await tokenFor("viewer");
  ids.stranger = null;
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

describe("size list — public read", () => {
  it("serves the list to an anonymous shopper, in order", async () => {
    const res = await agent.get(PUBLIC);
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "public, max-age=60, stale-while-revalidate=300");
    assert.deepEqual(
      res.body.data.map((s) => s.id),
      SEED_SIZES.map((s) => s.id),
    );
  });

  it("returns a name and position, and never the store's bookkeeping", async () => {
    const res = await agent.get(PUBLIC);
    for (const size of res.body.data) {
      assert.equal(typeof size.id, "string");
      assert.equal(typeof size.name, "string");
      assert.equal(typeof size.position, "number");
      assert.equal(size.createdAt, undefined, "a public read should not carry createdAt");
    }
  });

  it("carries the exact ids the storefront URLs and stock keys use", async () => {
    // The ids are the contract. `?size=eu38,m` and every `colorways[].stock` key
    // depend on them, so this is pinned rather than derived.
    const res = await agent.get(PUBLIC);
    const byId = Object.fromEntries(res.body.data.map((s) => [s.id, s.name]));
    assert.equal(byId.xs, "XS");
    assert.equal(byId.eu38, "EU 38 · UK 5 · US 7");
    assert.equal(byId["one-size"], "One Size");
  });
});

describe("size list — staff access", () => {
  it("refuses an anonymous read", async () => {
    const res = await agent.get(ADMIN);
    assert.equal(res.status, 401);
  });

  it("refuses a customer token at the staff boundary", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const bcrypt = (await import("bcryptjs")).default;
    const email = uniqueEmail("shopper");
    created.push(email);
    await prisma.user.create({
      data: {
        realm: "customer",
        name: "Shopper",
        email,
        role: "customer",
        passwordHash: bcrypt.hashSync(TEMP_PASSWORD, 10),
        mustChangePassword: false,
      },
    });
    const login = await agent.post("/api/v1/storefront/auth/login").send({ email, password: TEMP_PASSWORD });
    assert.equal(login.status, 200);

    for (const [method, path] of [["get", ADMIN], ["post", ADMIN], ["patch", `${ADMIN}/xs`], ["delete", `${ADMIN}/xs`]]) {
      const res = await agent[method](path).set("Authorization", `Bearer ${login.body.data.accessToken}`).send({ name: "Nope" });
      assert.equal(res.status, 403, `${method.toUpperCase()} ${path} should refuse a customer token, got ${res.status}`);
    }
  });

  it("lets a role with edit on Sizes write, and refuses one without", async () => {
    const allowed = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "XXL" });
    assert.equal(allowed.status, 201);

    const refused = await agent.post(ADMIN).set("Authorization", ids.viewer).send({ name: "Petite" });
    assert.equal(refused.status, 403);
  });
});

describe("size list — creating", () => {
  it("adds a size at the end of the list", async () => {
    const res = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "3XL" });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.name, "3XL");
    assert.ok(res.body.data.position > SEED_SIZES.length - 1, "a new size should not shuffle the shipped twelve");

    await agent.delete(`${ADMIN}/${res.body.data.id}`).set("Authorization", ids.content);
  });

  it("derives a readable id from the name", async () => {
    const res = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "Petite" });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, "petite");

    await agent.delete(`${ADMIN}/petite`).set("Authorization", ids.content);
  });

  it("refuses a duplicate name however it is capitalised", async () => {
    const res = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "  m  " });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /already on the list/);
  });

  it("refuses a blank name", async () => {
    for (const name of ["", "   "]) {
      const res = await agent.post(ADMIN).set("Authorization", ids.content).send({ name });
      assert.equal(res.status, 400);
    }
  });

  it("refuses an id that is already live", async () => {
    const res = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "Medium", id: "m" });
    assert.equal(res.status, 409);
  });
});

describe("size list — renaming", () => {
  it("changes the name and leaves the id and position alone", async () => {
    const res = await agent.patch(`${ADMIN}/m`).set("Authorization", ids.content).send({ name: "Medium" });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.name, "Medium");
    assert.equal(res.body.data.id, "m", "a rename must not change the id");

    const row = (await stored()).find((s) => s.id === "m");
    assert.equal(row.position, 2, "a rename must not move the size");
  });

  it("refuses a body carrying an id, rather than quietly ignoring it", async () => {
    // The one that matters. A client re-pointing an id is re-pointing every
    // stock row and every `?size=` URL holding it. Returning 200 and changing
    // only the name would hide that from both sides.
    const res = await agent.patch(`${ADMIN}/m`).set("Authorization", ids.content).send({ name: "Medium", id: "medium" });
    assert.equal(res.status, 400, "an extra id should be refused, not dropped");
  });

  it("refuses a body carrying a position", async () => {
    const res = await agent.patch(`${ADMIN}/m`).set("Authorization", ids.content).send({ name: "Medium", position: 0 });
    assert.equal(res.status, 400);
  });

  it("404s a rename of a size that is not there", async () => {
    const res = await agent.patch(`${ADMIN}/does-not-exist`).set("Authorization", ids.content).send({ name: "Nope" });
    assert.equal(res.status, 404);
  });
});

describe("size list — deleting and spent ids", () => {
  it("refuses a delete of a size that is not there", async () => {
    const res = await agent.delete(`${ADMIN}/does-not-exist`).set("Authorization", ids.content);
    assert.equal(res.status, 404);
  });

  it("removes the size", async () => {
    const res = await agent.delete(`${ADMIN}/xl`).set("Authorization", ids.content);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, "xl");

    const after = await agent.get(PUBLIC);
    assert.ok(!after.body.data.some((s) => s.id === "xl"), "the deleted size should be gone from the list");
  });

  it("never hands a deleted id to the next size", async () => {
    // The reason FreedId exists. A size deleted from the list is still
    // referenced by whatever carried it, and its stock is an object keyed on
    // this id. Re-issuing it would re-point all of that at a different size —
    // and the slug of a re-added "XL" lands exactly on the spent id, so the
    // derived path has to check the freed set too, not just the live one.
    const res = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "XL" });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, "xl-2", "a spent id must not be reissued by the derived path either");

    await agent.delete(`${ADMIN}/xl-2`).set("Authorization", ids.content);
  });

  it("refuses a requested id that is spent, rather than quietly issuing another", async () => {
    // Different contract from the case above, and deliberately so. A caller
    // that names an id and gets a different one back has been told 201 for a row
    // it did not ask for; a 409 is the honest answer.
    const res = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "XL", id: "xl" });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /already taken/);
  });

  it("suffices the id even when the same name is re-added without one", async () => {
    // Slug would land on the spent id, so the suffix has to come from the freed
    // set as well as the live one.
    const first = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "Tall" });
    assert.equal(first.body.data.id, "tall");
    await agent.delete(`${ADMIN}/tall`).set("Authorization", ids.content);

    const second = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "Tall" });
    assert.equal(second.body.data.id, "tall-2", "a re-added name must not reclaim the spent id");
    await agent.delete(`${ADMIN}/tall-2`).set("Authorization", ids.content);
  });
});

describe("size list — reset and audit", () => {
  it("restores the shipped list and marks added ids spent", async () => {
    const added = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "Petite" });
    assert.equal(added.status, 201);

    const res = await agent.post(`${ADMIN}/reset`).set("Authorization", ids.content);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.data.map((s) => s.id),
      SEED_SIZES.map((s) => s.id),
    );

    const reclaimed = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "Petite" });
    assert.notEqual(reclaimed.body.data.id, added.body.data.id, "a reset must not reissue the ids it spent");
    await agent.delete(`${ADMIN}/${reclaimed.body.data.id}`).set("Authorization", ids.content);
  });

  it("is not read as a size id called reset", async () => {
    // Guards the route order rather than the resource: `POST /reset` has to beat
    // `/:id`, or a reset would look like a fetch of a size called "reset".
    const res = await agent.get(`${ADMIN}/reset`).set("Authorization", ids.content);
    assert.equal(res.status, 404);
  });

  it("records who did what, without inventing a size that was not written", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const created1 = await agent.post(ADMIN).set("Authorization", ids.content).send({ name: "Audit Probe" });
    const id = created1.body.data.id;
    await agent.patch(`${ADMIN}/${id}`).set("Authorization", ids.content).send({ name: "Audit Probe 2" });
    await agent.delete(`${ADMIN}/${id}`).set("Authorization", ids.content);

    const rows = await prisma.auditLog.findMany({ where: { action: { in: ["SIZE_CREATE", "SIZE_RENAME", "SIZE_DELETE"] } } });
    const create = rows.find((r) => r.meta?.id === id && r.action === "SIZE_CREATE");
    const rename = rows.find((r) => r.meta?.id === id && r.action === "SIZE_RENAME");
    const remove = rows.find((r) => r.meta?.id === id && r.action === "SIZE_DELETE");
    assert.ok(create, "the create should be audited");
    assert.equal(rename.meta.from, "Audit Probe");
    assert.equal(rename.meta.to, "Audit Probe 2");
    assert.equal(remove.meta.id, id);
  });
});
