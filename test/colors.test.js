/* Colour Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";
import { SEED_COLORS } from "../src/features/colors/seed.js";

/**
 * The colour list, once it is the server's. Weighted towards the id contract:
 * products store their colourways by colour id, so an id that changed or was
 * reissued would silently re-colour every product holding it.
 */

const PUBLIC = "/api/v1/storefront/taxonomy/colors";
const ADMIN = "/api/v1/admin/taxonomy/colors";
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

async function restoreList() {
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.color.deleteMany();
  await prisma.freedId.deleteMany({ where: { kind: "color" } });
  for (const row of SEED_COLORS) await prisma.color.create({ data: row });
}

const body = (over = {}) => ({ name: "Sapphire", hex: "#1f3a93", family: "blue", ...over });

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

describe("colours — reading and access", () => {
  it("serves the list to an anonymous shopper, alphabetically", async () => {
    const res = await agent.get(PUBLIC);
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "public, max-age=60, stale-while-revalidate=300");
    const names = res.body.data.map((c) => c.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.equal(res.body.data.length, SEED_COLORS.length);
    const ebony = res.body.data.find((c) => c.id === "ebony");
    assert.deepEqual({ name: ebony.name, hex: ebony.hex, family: ebony.family }, { name: "Ebony", hex: "#120700", family: "black" });
  });

  it("refuses an anonymous staff read and a write without edit", async () => {
    assert.equal((await agent.get(ADMIN)).status, 401);
    assert.equal((await agent.post(ADMIN).set("Authorization", auth.viewer).send(body())).status, 403);
  });
});

describe("colours — writing", () => {
  it("adds a colour with a derived id and an uppercased swatch", async () => {
    const res = await agent.post(ADMIN).set("Authorization", auth.content).send(body());
    assert.equal(res.status, 201);
    assert.equal(res.body.data.id, "sapphire");
    assert.equal(res.body.data.hex, "#1F3A93");
  });

  it("refuses a duplicate name, a bad hex, a missing family, or a supplied id", async () => {
    for (const bad of [{ name: " ebony " }, { hex: "blue" }, { family: "" }, { id: "x" }]) {
      const res = await agent.post(ADMIN).set("Authorization", auth.content).send(body(bad));
      assert.ok([400, 409].includes(res.status), `${JSON.stringify(bad)} → ${res.status}`);
    }
  });

  it("updates name, swatch and family but never the id", async () => {
    const res = await agent.patch(`${ADMIN}/sapphire`).set("Authorization", auth.content).send(body({ name: "Royal Blue", hex: "#002366" }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, "sapphire");
    assert.equal(res.body.data.name, "Royal Blue");

    const withId = await agent.patch(`${ADMIN}/sapphire`).set("Authorization", auth.content).send(body({ id: "royal" }));
    assert.equal(withId.status, 400);

    assert.equal((await agent.patch(`${ADMIN}/nope`).set("Authorization", auth.content).send(body({ name: "Nope" }))).status, 404);
  });

  it("deletes and never reissues the id", async () => {
    assert.equal((await agent.delete(`${ADMIN}/sapphire`).set("Authorization", auth.content)).status, 200);
    const again = await agent.post(ADMIN).set("Authorization", auth.content).send(body());
    assert.equal(again.body.data.id, "sapphire-2");
  });

  it("resets to the shipped list and spends added ids", async () => {
    const res = await agent.post(`${ADMIN}/reset`).set("Authorization", auth.content);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, SEED_COLORS.length);
    assert.ok(!res.body.data.some((c) => c.id === "sapphire-2"));
    const again = await agent.post(ADMIN).set("Authorization", auth.content).send(body());
    assert.equal(again.body.data.id, "sapphire-3");
  });

  it("records the writes in the audit log", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    const actions = new Set(
      (await prisma.auditLog.findMany({ where: { action: { in: ["COLOR_CREATE", "COLOR_UPDATE", "COLOR_DELETE", "COLOR_RESET"] } } })).map((r) => r.action),
    );
    assert.equal(actions.size, 4);
  });
});
