/* Upload Tests */

import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";

/**
 * Uploads, against local disk storage (no ImageKit keys in the test env). The
 * point is the gate: only real photos and videos are stored, by their bytes,
 * and only by staff who edit something that carries one.
 */

const ADMIN = "/api/v1/admin/uploads";
const TEMP_PASSWORD = "Temporary123";
const created = [];
const stored = [];
let agent;
const auth = {};

// The smallest valid PNG: a 1×1 transparent pixel.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f20000000049454e44ae426082",
  "hex",
);

async function tokenFor(role) {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  await prisma.user.create({
    data: { realm: "staff", name: `Test ${role}`, email, role, passwordHash: bcrypt.hashSync(TEMP_PASSWORD, 10), mustChangePassword: false },
  });
  const res = await agent.post("/api/v1/admin/auth/login").send({ email, password: TEMP_PASSWORD });
  return `Bearer ${res.body.data.accessToken}`;
}

before(async () => {
  agent = await api();
  auth.content = await tokenFor("content");
  auth.support = await tokenFor("support");
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const { env } = await import("../src/config/index.js");
  for (const url of stored) await rm(path.resolve(env.UPLOAD_DIR, path.basename(url)), { force: true });
  await teardown();
});

describe("uploads", () => {
  it("stores a real photo and serves it back, cacheable for good", async () => {
    const res = await agent.post(ADMIN).set("Authorization", auth.content).field("folder", "products").attach("file", PNG, "pixel.png");
    assert.equal(res.status, 201);
    assert.equal(res.body.data.kind, "image");
    assert.match(res.body.data.url, /^\/api\/uploads\/.+\.png$/);
    stored.push(res.body.data.url);

    const served = await agent.get(res.body.data.url);
    assert.equal(served.status, 200);
    assert.match(served.headers["cache-control"], /immutable/);
    const { env } = await import("../src/config/index.js");
    assert.deepEqual(await readFile(path.resolve(env.UPLOAD_DIR, path.basename(res.body.data.url))), PNG);
  });

  it("decides the type from the bytes, not the name", async () => {
    const res = await agent.post(ADMIN).set("Authorization", auth.content).attach("file", Buffer.from("<script>alert(1)</script>"), "photo.jpg");
    assert.equal(res.status, 415);
  });

  it("refuses an upload from a role that edits nothing with photos, and an empty request", async () => {
    assert.equal((await agent.post(ADMIN).set("Authorization", auth.support).attach("file", PNG, "pixel.png")).status, 403);
    assert.equal((await agent.post(ADMIN).set("Authorization", auth.content)).status, 400);
    assert.equal((await agent.post(ADMIN).attach("file", PNG, "pixel.png")).status, 401);
  });
});
