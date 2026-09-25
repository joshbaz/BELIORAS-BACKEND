/* Auth Flow Tests */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { api, cookieDirective, refreshCookie, uniqueEmail } from "./helpers.js";

const PASSWORD = "Password123";
const created = [];

function track(email) {
  created.push(email);
}

function authenticateAs(res) {
  const { accessToken } = res.body.data;
  return `Bearer ${accessToken}`;
}

async function register(realm = "customer", overrides = {}) {
  const email = overrides.email ?? uniqueEmail();
  track(email);
  return api().then((request) =>
    request.post("/api/v1/auth/register").send({ realm, email, name: "Test User", password: PASSWORD, ...overrides }),
  );
}

async function cleanupCreated() {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}

after(async () => {
  await cleanupCreated();
  const { teardown } = await import("./helpers.js");
  await teardown();
});

describe("register", () => {
  it("creates an account and issues a session", async () => {
    const res = await register();
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.email.includes("@example.com"), true);
    assert.ok(res.body.data.accessToken);
    assert.ok(refreshCookie(res));
  });

  it("rejects a duplicate email in the same realm with 409", async () => {
    const email = uniqueEmail();
    const first = await register("customer", { email });
    assert.equal(first.status, 201);

    const second = await register("customer", { email });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, "CONFLICT");
  });
});

describe("login", () => {
  it("returns a session for valid credentials", async () => {
    const email = uniqueEmail();
    await register("customer", { email });

    const res = await api().then((request) =>
      request.post("/api/v1/auth/login").send({ realm: "customer", email, password: PASSWORD }),
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.accessToken);
    assert.ok(refreshCookie(res));
  });

  it("rejects a wrong password with a uniform 401", async () => {
    const email = uniqueEmail();
    await register("customer", { email });

    const res = await api().then((request) =>
      request.post("/api/v1/auth/login").send({ realm: "customer", email, password: "WrongPass1" }),
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  });

  it("keeps realms separate: a staff email cannot log in as customer", async () => {
    const email = uniqueEmail();
    await register("staff", { email });

    const res = await api().then((request) =>
      request.post("/api/v1/auth/login").send({ realm: "customer", email, password: PASSWORD }),
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  });
});

describe("authenticated endpoints", () => {
  it("GET /auth/me returns the public user, never secrets", async () => {
    const res = await register();
    const bearer = authenticateAs(res);

    const me = await api().then((request) => request.get("/api/v1/auth/me").set("Authorization", bearer));
    assert.equal(me.status, 200);
    assert.ok(me.body.data.email);
    assert.equal(me.body.data.passwordHash, undefined);
    assert.equal(me.body.data.refreshHash, undefined);
  });

  it("GET /auth/me without a token is a 401", async () => {
    const me = await api().then((request) => request.get("/api/v1/auth/me"));
    assert.equal(me.status, 401);
    assert.equal(me.body.error.code, "UNAUTHORIZED");
  });
});

describe("refresh rotation", () => {
  it("rotates the refresh token, then rejects reuse and revokes", async () => {
    const res = await register();
    const oldCookie = cookieDirective(refreshCookie(res));

    const rotated = await api().then((request) =>
      request
        .post("/api/v1/auth/refresh")
        .set("Cookie", oldCookie)
        .set("X-Auth-Realm", "customer"),
    );
    assert.equal(rotated.status, 200);
    const newAccessToken = rotated.body.data.accessToken;
    assert.ok(newAccessToken);
    assert.ok(refreshCookie(rotated));
    assert.notEqual(cookieDirective(refreshCookie(rotated)), oldCookie);

    // Presenting the spent token must fail AND revoke the whole session.
    const reuse = await api().then((request) =>
      request
        .post("/api/v1/auth/refresh")
        .set("Cookie", oldCookie)
        .set("X-Auth-Realm", "customer"),
    );
    assert.equal(reuse.status, 401);

    const me = await api().then((request) => request.get("/api/v1/auth/me").set("Authorization", `Bearer ${newAccessToken}`));
    assert.equal(me.status, 401);
  });

  it("rejects a refresh without a realm header", async () => {
    const res = await register();
    const cookie = cookieDirective(refreshCookie(res));

    const refresh = await api().then((request) => request.post("/api/v1/auth/refresh").set("Cookie", cookie));
    assert.equal(refresh.status, 401);
  });
});

describe("logout-all", () => {
  it("revokes all sessions immediately (bypassing the session cache)", async () => {
    const res = await register();
    const bearer = authenticateAs(res);
    const cookie = cookieDirective(refreshCookie(res));

    const me = await api().then((request) => request.get("/api/v1/auth/me").set("Authorization", bearer));
    assert.equal(me.status, 200);

    const logoutAll = await api().then((request) =>
      request.post("/api/v1/auth/logout-all").set("Cookie", cookie).set("X-Auth-Realm", "customer"),
    );
    assert.equal(logoutAll.status, 204);

    const after = await api().then((request) => request.get("/api/v1/auth/me").set("Authorization", bearer));
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, "UNAUTHORIZED");
  });
});

describe("preferences", () => {
  it("updates and persists preferences", async () => {
    const res = await register();
    const bearer = authenticateAs(res);

    const upgrade = await api().then((request) =>
      request
        .patch("/api/v1/auth/me/preferences")
        .set("Authorization", bearer)
        .send({ preferences: { theme: "dark", locale: "en" } }),
    );
    assert.equal(upgrade.status, 200);
    assert.equal(upgrade.body.data.preferences.theme, "dark");

    const me = await api().then((request) => request.get("/api/v1/auth/me").set("Authorization", bearer));
    assert.equal(me.status, 200);
    assert.equal(me.body.data.preferences.locale, "en");
  });
});