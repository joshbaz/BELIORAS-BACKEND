/* Newsletter And Contact Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";

/**
 * The Letter's consent rules — double opt-in, one welcome code per address,
 * unsubscribe keeps the record, erasure removes it, a sent campaign is final —
 * and the contact form keeping every message.
 */

const SHOP = "/api/v1/storefront";
const ADMIN = "/api/v1/admin";
const PASSWORD = "Temporary123";
const created = [];
let agent;
const auth = {};

async function tokenFor(role) {
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
  for (const model of ["subscriber", "campaign", "contactMessage"]) await prisma[model].deleteMany();
  await prisma.setting.deleteMany({ where: { id: "newsletter" } });
  await prisma.coupon.deleteMany({ where: { code: "WELCOME10" } });
  await prisma.coupon.create({ data: { id: "cw", code: "WELCOME10", type: "percent", value: 10 } });
  auth.content = await tokenFor("content");
  auth.support = await tokenFor("support");
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  for (const model of ["subscriber", "campaign", "contactMessage"]) await prisma[model].deleteMany();
  await prisma.coupon.deleteMany({ where: { id: "cw" } });
  await teardown();
});

describe("newsletter", () => {
  let token;

  it("signs up as pending, and confirms once with a single welcome code", async () => {
    const res = await agent.post(`${SHOP}/newsletter/subscribe`).send({ email: "Reader@Example.com" });
    assert.equal(res.body.data.status, "pending");
    token = res.body.data.token;

    const confirmed = await agent.post(`${SHOP}/newsletter/confirm`).send({ token });
    assert.deepEqual([confirmed.body.data.email, confirmed.body.data.welcomeCode], ["reader@example.com", "WELCOME10"]);

    // Leave and rejoin: no second code.
    await agent.post(`${SHOP}/newsletter/unsubscribe`).send({ token });
    const again = await agent.post(`${SHOP}/newsletter/subscribe`).send({ email: "reader@example.com" });
    const reconfirmed = await agent.post(`${SHOP}/newsletter/confirm`).send({ token: again.body.data.token });
    assert.equal(reconfirmed.body.data.welcomeCode, null);
  });

  it("sends a campaign once to confirmed readers, then refuses to change it", async () => {
    const saved = await agent.post(`${ADMIN}/newsletter/campaigns`).set("Authorization", auth.content).send({ subject: "Autumn", heading: "The edit", body: "New pieces." });
    assert.equal(saved.status, 200);
    const id = saved.body.data.id;
    const sent = await agent.post(`${ADMIN}/newsletter/campaigns/${id}/send`).set("Authorization", auth.content);
    assert.deepEqual([sent.body.data.status, sent.body.data.recipients], ["sent", 1]);
    assert.equal((await agent.post(`${ADMIN}/newsletter/campaigns/${id}/send`).set("Authorization", auth.content)).status, 409);
    assert.equal((await agent.delete(`${ADMIN}/newsletter/campaigns/${id}`).set("Authorization", auth.content)).status, 409);
  });

  it("sends a scheduled campaign when it is due", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const saved = await agent.post(`${ADMIN}/newsletter/campaigns`).set("Authorization", auth.content).send({ subject: "Later", heading: "Soon", body: "Text." });
    const id = saved.body.data.id;
    await agent.post(`${ADMIN}/newsletter/campaigns/${id}/schedule`).set("Authorization", auth.content).send({ sendAt: new Date(Date.now() + 60_000).toISOString() });
    await prisma.campaign.update({ where: { id }, data: { sendAt: new Date(Date.now() - 1000) } });
    const { sendDueCampaigns } = await import("../src/features/marketing/marketing.service.js");
    assert.deepEqual(await sendDueCampaigns(), [id]);
  });

  it("erases a subscriber entirely, for moderators of the newsletter only", async () => {
    const list = (await agent.get(`${ADMIN}/newsletter/subscribers`).set("Authorization", auth.content)).body.data;
    assert.equal((await agent.delete(`${ADMIN}/newsletter/subscribers/${list[0].id}`).set("Authorization", auth.support)).status, 403);
    assert.equal((await agent.delete(`${ADMIN}/newsletter/subscribers/${list[0].id}`).set("Authorization", auth.content)).status, 200);
    assert.equal((await agent.get(`${ADMIN}/newsletter/subscribers`).set("Authorization", auth.content)).body.data.length, 0);
  });
});

describe("contact", () => {
  it("keeps the message and queues it to client care", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const res = await agent.post(`${SHOP}/contact`).send({ name: "Ada", email: "ada@example.com", subject: "Sizing", message: "Does it run small?" });
    assert.equal(res.status, 201);
    const queued = await prisma.email.findMany({ where: { type: "contact-received" } });
    assert.ok(queued.some((e) => e.data?.replyTo === "ada@example.com"));
    const inbox = (await agent.get(`${ADMIN}/contact/messages`).set("Authorization", auth.support)).body.data;
    assert.equal(inbox[0].message, "Does it run small?");
    assert.equal((await agent.post(`${SHOP}/contact`).send({ name: "", email: "x@example.com", message: "" })).status, 400);
  });
});
