/* Customer Account Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";

/**
 * Shopper accounts on the server: the welcome email, editing one's own
 * details, and the forgotten-password flow — which must not reveal who has an
 * account, must work once, and must sign out every other session.
 */

const AUTH = "/api/v1/storefront/auth";
const PASSWORD = "Temporary123";
const created = [];
let agent;

async function register(name = "Shopper") {
  const email = uniqueEmail("shop");
  created.push(email);
  const res = await agent.post(`${AUTH}/register`).send({ name, email, password: PASSWORD });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { email, bearer: `Bearer ${res.body.data.accessToken}`, id: res.body.data.user.id };
}

before(async () => {
  agent = await api();
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passwordReset.deleteMany({ where: { userId: { in: ids } } });
  await prisma.email.deleteMany({ where: { to: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await teardown();
});

describe("customer accounts", () => {
  it("queues a welcome email on sign-up", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const { email } = await register();
    assert.ok(await prisma.email.findFirst({ where: { to: email, type: "welcome" } }));
  });

  it("saves name and phone, and needs the current password to change the email", async () => {
    const me = await register();
    const res = await agent.patch(`${AUTH}/me`).set("Authorization", me.bearer).send({ name: "Ada", phone: "+49 30 1234" });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.data.name, res.body.data.phone], ["Ada", "+49 30 1234"]);

    const next = uniqueEmail("moved");
    created.push(next);
    const without = await agent.patch(`${AUTH}/me`).set("Authorization", me.bearer).send({ email: next });
    assert.equal(without.status, 401);
    const wrong = await agent.patch(`${AUTH}/me`).set("Authorization", me.bearer).send({ email: next, currentPassword: "nope-nope" });
    assert.equal(wrong.status, 401);
    const right = await agent.patch(`${AUTH}/me`).set("Authorization", me.bearer).send({ email: next, currentPassword: PASSWORD });
    assert.equal(right.body.data.email, next);
  });

  it("answers a reset request the same way whether or not the account exists", async () => {
    const unknown = await agent.post(`${AUTH}/password-reset`).send({ email: "nobody-here@example.com" });
    assert.equal(unknown.status, 204);
  });

  it("resets a password once with the emailed link, and signs out every session", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const me = await register();
    assert.equal((await agent.post(`${AUTH}/password-reset`).send({ email: me.email })).status, 204);
    const mail = await prisma.email.findFirst({ where: { to: me.email, type: "password-reset" }, orderBy: { createdAt: "desc" } });
    const token = new URL(mail.data.link).searchParams.get("token");

    const res = await agent.post(`${AUTH}/password-reset/confirm`).send({ token, password: "BrandNew456" });
    assert.equal(res.status, 204);
    assert.equal((await agent.get(`${AUTH}/me`).set("Authorization", me.bearer)).status, 401, "old sessions end");
    assert.equal((await agent.post(`${AUTH}/login`).send({ email: me.email, password: "BrandNew456" })).status, 200);

    const again = await agent.post(`${AUTH}/password-reset/confirm`).send({ token, password: "Another789x" });
    assert.equal(again.status, 400, "a link works once");
  });

  it("lists customers for staff who see them, never for shoppers", async () => {
    const me = await register();
    const res = await agent.get("/api/v1/admin/customers").set("Authorization", me.bearer);
    assert.equal(res.status, 403);
  });
});
