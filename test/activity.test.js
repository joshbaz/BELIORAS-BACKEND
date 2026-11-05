/* Activity Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";

/**
 * The Activity page reads the server's audit log: every member of staff sees
 * the same history, failed sign-ins are recorded without revealing whether
 * the email exists, and only roles with Activity access can read it.
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
  return { header: `Bearer ${res.body.data.accessToken}`, id: user.id, email };
}

before(async () => {
  agent = await api();
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { action: "LOGIN_FAILED", userId: null }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await teardown();
});

describe("activity", () => {
  it("shows sign-ins, failed sign-ins and changes to every admin, from the server", async () => {
    const admin = await signIn("super-admin");
    await agent.post(`${ADMIN}/auth/login`).send({ email: admin.email, password: "WrongPassword1" });
    await agent.post(`${ADMIN}/auth/login`).send({ email: "nobody@belioras.com", password: "WrongPassword1" });
    await agent.put(`${ADMIN}/inventory/settings`).set("Authorization", admin.header).send({ lowStockThreshold: 6 });

    const other = await signIn("super-admin");
    const res = await agent.get(`${ADMIN}/activity`).set("Authorization", other.header);
    assert.equal(res.status, 200);
    const mine = res.body.data.filter((e) => e.actorId === admin.id || e.actorEmail === "nobody@belioras.com");
    const summaries = mine.map((e) => e.summary);
    assert.ok(summaries.includes("Signed in"));
    assert.ok(summaries.includes("Set the low-stock level to 6"), "another admin sees the change");
    assert.ok(mine.some((e) => e.outcome === "failed" && e.actorId === admin.id));
    assert.ok(res.body.data.some((e) => e.outcome === "failed" && e.actorEmail === "nobody@belioras.com"));

    const signIns = (await agent.get(`${ADMIN}/activity/sign-ins`).set("Authorization", other.header)).body.data;
    assert.ok(signIns[admin.id], "the Team roster's last sign-in is real now");
  });

  it("is closed to roles without Activity access", async () => {
    const content = await signIn("content");
    assert.equal((await agent.get(`${ADMIN}/activity`).set("Authorization", content.header)).status, 403);
  });
});
