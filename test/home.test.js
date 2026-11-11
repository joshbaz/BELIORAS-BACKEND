/* Home Page Tile Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, teardown, uniqueEmail } from "./helpers.js";

/**
 * The home page's photo tiles live on the server: shoppers read them, an editor
 * saves the whole list naming the version they loaded, a stale save is refused,
 * a tile can only open a page that is in the mega menu, and a role without
 * "edit" on Home page cannot save.
 */

const PASSWORD = "Temporary123";
const created = [];
let agent;
let editor;
let viewer;

async function signIn(role) {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  await prisma.user.create({ data: { realm: "staff", name: `Test ${role}`, email, role, passwordHash: bcrypt.hashSync(PASSWORD, 10), mustChangePassword: false } });
  const res = await agent.post("/api/v1/admin/auth/login").send({ email, password: PASSWORD });
  return `Bearer ${res.body.data.accessToken}`;
}

const tile = (over = {}) => ({ name: "Dresses", tagline: "Draped", image: "https://ik.imagekit.io/x/d.jpg", url: "/dresses", ...over });

before(async () => {
  agent = await api();
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.setting.deleteMany({ where: { id: "home" } });
  editor = await signIn("super-admin");
  viewer = await signIn("finance");
});

after(async () => {
  const { prisma } = await import("../src/db/prisma.js");
  await prisma.setting.deleteMany({ where: { id: "home" } });
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await teardown();
});

describe("Home page tiles", () => {
  it("serves the shipped tiles to shoppers on a fresh database", async () => {
    const res = await agent.get("/api/v1/storefront/home/tiles");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((t) => t.url), ["/dresses", "/hair", "/accessories"]);
    assert.ok(res.body.data.every((t) => t.image && t.name && !("linked" in t)));
  });

  it("saves the whole list for an editor, and refuses a stale version", async () => {
    const loaded = await agent.get("/api/v1/admin/home/tiles").set("Authorization", editor);
    assert.equal(loaded.status, 200);
    const { version } = loaded.body.data;

    const saved = await agent
      .put("/api/v1/admin/home/tiles")
      .set("Authorization", editor)
      .send({ version, tiles: [tile({ id: "dresses" }), tile({ name: "Hair", url: "/hair" })] });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.tiles.length, 2);
    assert.equal(saved.body.data.tiles[0].id, "dresses");
    assert.match(saved.body.data.tiles[1].id, /^tile-/);
    assert.notEqual(saved.body.data.version, version);

    const shop = await agent.get("/api/v1/storefront/home/tiles");
    assert.deepEqual(shop.body.data.map((t) => t.name), ["Dresses", "Hair"]);

    const stale = await agent.put("/api/v1/admin/home/tiles").set("Authorization", editor).send({ version, tiles: [tile()] });
    assert.equal(stale.status, 409);
  });

  it("refuses a link that is not a page in the mega menu", async () => {
    const { version } = (await agent.get("/api/v1/admin/home/tiles").set("Authorization", editor)).body.data;
    const res = await agent
      .put("/api/v1/admin/home/tiles")
      .set("Authorization", editor)
      .send({ version, tiles: [tile({ url: "/not-a-page" })] });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /not in the mega menu/);
  });

  it("refuses a photo that was never uploaded", async () => {
    const { version } = (await agent.get("/api/v1/admin/home/tiles").set("Authorization", editor)).body.data;
    const res = await agent
      .put("/api/v1/admin/home/tiles")
      .set("Authorization", editor)
      .send({ version, tiles: [tile({ image: "blob:http://localhost/abc" })] });
    assert.equal(res.status, 400);
  });

  it("does not let a role without edit on Home page save", async () => {
    const { version } = (await agent.get("/api/v1/admin/home/tiles").set("Authorization", editor)).body.data;
    const res = await agent.put("/api/v1/admin/home/tiles").set("Authorization", viewer).send({ version, tiles: [tile()] });
    assert.equal(res.status, 403);
  });
});
