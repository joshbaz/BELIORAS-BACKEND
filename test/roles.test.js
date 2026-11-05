/* Role Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";

/**
 * Roles, now that the server reads them: a role made or edited under Team →
 * Roles changes what the server allows, and the rules that stop a team
 * locking itself out or over-granting hold here.
 */

const ADMIN = "/api/v1/admin";
const PASSWORD = "Temporary123";
const created = [];
let agent;

async function signIn(role) {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  const user = await prisma.user.create({ data: { realm: "staff", name: `Test ${role}`, email, role, passwordHash: bcrypt.hashSync(PASSWORD, 10), mustChangePassword: false } });
  const res = await agent.post(`${ADMIN}/auth/login`).send({ email, password: PASSWORD });
  return { header: `Bearer ${res.body.data.accessToken}`, id: user.id };
}

before(async () => {
  agent = await api();
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.role.deleteMany();
  (await import("../src/features/roles/roles.service.js")).resetRoleCache();
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // Every role goes, so the shipped ones (including the "staff" role edited
  // above) are recreated as they shipped on the next read.
  await prisma.role.deleteMany();
  await teardown();
});

describe("roles", () => {
  it("creates the shipped roles on first read, readable by any staff", async () => {
    const support = await signIn("support");
    const res = await agent.get(`${ADMIN}/roles`).set("Authorization", support.header);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((r) => r.id), ["super-admin", "staff", "finance", "support", "content", "developer"]);
  });

  it("gives a new role's holders exactly what it says, on the server", async () => {
    const admin = await signIn("super-admin");
    const made = await agent.post(`${ADMIN}/roles`).set("Authorization", admin.header).send({ name: "Stock Keeper", permissions: { inventory: "edit", products: "view" } });
    assert.equal(made.status, 201);
    assert.equal(made.body.data.id, "stock-keeper");

    const keeper = await signIn("stock-keeper");
    assert.equal((await agent.get(`${ADMIN}/inventory/settings`).set("Authorization", keeper.header)).status, 200);
    assert.equal((await agent.put(`${ADMIN}/inventory/settings`).set("Authorization", keeper.header).send({ lowStockThreshold: 4 })).status, 200);
    assert.equal((await agent.post(`${ADMIN}/products`).set("Authorization", keeper.header).send({ name: "x", collectionId: "dresses", price: 1 })).status, 403, "view only on Products");

    // Taking Inventory edit away takes it away on the server, at once.
    await agent.patch(`${ADMIN}/roles/stock-keeper`).set("Authorization", admin.header).send({ name: "Stock Keeper", permissions: { inventory: "view" } });
    assert.equal((await agent.put(`${ADMIN}/inventory/settings`).set("Authorization", keeper.header).send({ lowStockThreshold: 5 })).status, 403);
  });

  it("stops anyone granting more than they hold, editing their own role, or touching the Administrator", async () => {
    const admin = await signIn("super-admin");
    const { prisma } = await import("../src/db/prisma.js");
    await prisma.role.update({ where: { id: "staff" }, data: { permissions: { team: "edit", orders: "edit" } } });
    (await import("../src/features/roles/roles.service.js")).resetRoleCache();
    const lead = await signIn("staff");

    const over = await agent.post(`${ADMIN}/roles`).set("Authorization", lead.header).send({ name: "Too Much", permissions: { settings: "edit" } });
    assert.equal(over.status, 403);
    const own = await agent.patch(`${ADMIN}/roles/staff`).set("Authorization", lead.header).send({ name: "Staff", permissions: { orders: "view" } });
    assert.equal(own.status, 403);
    const locked = await agent.patch(`${ADMIN}/roles/super-admin`).set("Authorization", admin.header).send({ name: "Admin", permissions: { orders: "view" } });
    assert.equal(locked.status, 403);
    const ghost = await agent.post(`${ADMIN}/auth/staff`).set("Authorization", admin.header).send({ name: "G", email: uniqueEmail("ghost"), role: "no-such-role", password: PASSWORD });
    assert.equal(ghost.status, 400, "a role must exist to be assigned");
  });

  it("refuses to delete a role someone holds", async () => {
    const admin = await signIn("super-admin");
    const res = await agent.delete(`${ADMIN}/roles/stock-keeper`).set("Authorization", admin.header);
    assert.equal(res.status, 409);
  });
});
