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

/** Seeds a staff user directly (bypassing the one-time register gate). */
async function seedStaff(email, password = PASSWORD) {
  track(email);
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  await prisma.user.create({
    data: { realm: "staff", name: "Staff User", email, passwordHash: bcrypt.hashSync(password, 10) },
  });
  return email;
}

async function register(realm = "customer", overrides = {}) {
  const email = overrides.email ?? uniqueEmail();
  track(email);
  const boundary = realm === "staff" ? "admin" : "storefront";
  return api().then((request) =>
    request.post(`/api/v1/${boundary}/auth/register`).send({ email, name: "Test User", password: PASSWORD, ...overrides }),
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
    // Browsers only send the cookie to routes covered by its Path — both
    // boundary auth namespaces live under /api/v1.
    assert.match(refreshCookie(res), /Path=\/api\/v1/i);
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
      request.post("/api/v1/storefront/auth/login").send({ email, password: PASSWORD }),
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.accessToken);
    assert.ok(refreshCookie(res));
  });

  it("rejects a wrong password with a uniform 401", async () => {
    const email = uniqueEmail();
    await register("customer", { email });

    const res = await api().then((request) =>
      request.post("/api/v1/storefront/auth/login").send({ email, password: "WrongPass1" }),
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  });

  it("keeps realms separate: a staff email cannot log in as customer", async () => {
    const email = uniqueEmail();
    // Seed directly — the public staff register is gated to one-time bootstrap.
    await seedStaff(email);

    const res = await api().then((request) =>
      request.post("/api/v1/storefront/auth/login").send({ email, password: PASSWORD }),
    );
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "UNAUTHORIZED");
  });
});

describe("authenticated endpoints", () => {
  it("GET /auth/me returns the public user, never secrets", async () => {
    const res = await register();
    const bearer = authenticateAs(res);

    const me = await api().then((request) => request.get("/api/v1/storefront/auth/me").set("Authorization", bearer));
    assert.equal(me.status, 200);
    assert.ok(me.body.data.email);
    assert.equal(me.body.data.passwordHash, undefined);
    assert.equal(me.body.data.refreshHash, undefined);
  });

  it("GET /auth/me without a token is a 401", async () => {
    const me = await api().then((request) => request.get("/api/v1/storefront/auth/me"));
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
        .post("/api/v1/storefront/auth/refresh")
        .set("Cookie", oldCookie)
    );
    assert.equal(rotated.status, 200);
    const newAccessToken = rotated.body.data.accessToken;
    assert.ok(newAccessToken);
    assert.ok(refreshCookie(rotated));
    assert.notEqual(cookieDirective(refreshCookie(rotated)), oldCookie);

    // Presenting the spent token must fail AND revoke the whole session.
    const reuse = await api().then((request) =>
      request
        .post("/api/v1/storefront/auth/refresh")
        .set("Cookie", oldCookie)
    );
    assert.equal(reuse.status, 401);

    const me = await api().then((request) => request.get("/api/v1/storefront/auth/me").set("Authorization", `Bearer ${newAccessToken}`));
    assert.equal(me.status, 401);
  });

  it("rejects a refresh without a realm cookie", async () => {
    await register();
    // Intentionally omit the cookie

    const refresh = await api().then((request) => request.post("/api/v1/storefront/auth/refresh"));
    assert.equal(refresh.status, 401);
  });
});

describe("logout-all", () => {
  it("revokes all sessions immediately (bypassing the session cache)", async () => {
    const res = await register();
    const bearer = authenticateAs(res);
    const cookie = cookieDirective(refreshCookie(res));

    const me = await api().then((request) => request.get("/api/v1/storefront/auth/me").set("Authorization", bearer));
    assert.equal(me.status, 200);

    const logoutAll = await api().then((request) =>
      request.post("/api/v1/storefront/auth/logout-all").set("Cookie", cookie)
    );
    assert.equal(logoutAll.status, 204);

    const after = await api().then((request) => request.get("/api/v1/storefront/auth/me").set("Authorization", bearer));
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
        .patch("/api/v1/storefront/auth/me/preferences")
        .set("Authorization", bearer)
        .send({ preferences: { theme: "dark", locale: "en" } }),
    );
    assert.equal(upgrade.status, 200);
    assert.equal(upgrade.body.data.preferences.theme, "dark");

    const me = await api().then((request) => request.get("/api/v1/storefront/auth/me").set("Authorization", bearer));
    assert.equal(me.status, 200);
    assert.equal(me.body.data.preferences.locale, "en");
  });
});

describe("staff bootstrap registration", () => {
  it("allows the very first staff registration", async () => {
    const { prisma } = await import("../src/db/prisma.js");
    // Dedicated test database: start the staff table empty to disprove the gate.
    const staff = await prisma.user.findMany({ where: { realm: "staff" }, select: { id: true } });
    const staffIds = staff.map((u) => u.id);
    await prisma.session.deleteMany({ where: { userId: { in: staffIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: staffIds } } });
    await prisma.user.deleteMany({ where: { id: { in: staffIds } } });

    const res = await register("staff");
    assert.equal(res.status, 201);
    assert.ok(res.body.data.accessToken);
  });

  it("rejects any further staff registration", async () => {
    // A staff account now exists from the test above.
    const res = await register("staff");
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "CONFLICT");
  });
});

describe("boundary enforcement", () => {
  it("forbids a staff token on the storefront and a customer token in admin", async () => {
    const staffEmail = uniqueEmail();
    await seedStaff(staffEmail);

    const staffLogin = await api().then((request) =>
      request.post("/api/v1/admin/auth/login").send({ email: staffEmail, password: PASSWORD }),
    );
    assert.equal(staffLogin.status, 200);
    const staffBearer = `Bearer ${staffLogin.body.data.accessToken}`;

    const customer = await register();
    const customerBearer = authenticateAs(customer);

    const staffOnStorefront = await api().then((request) =>
      request.get("/api/v1/storefront/auth/me").set("Authorization", staffBearer),
    );
    assert.equal(staffOnStorefront.status, 403);
    assert.equal(staffOnStorefront.body.error.code, "FORBIDDEN");

    const customerOnAdmin = await api().then((request) =>
      request.get("/api/v1/admin/auth/me").set("Authorization", customerBearer),
    );
    assert.equal(customerOnAdmin.status, 403);
    assert.equal(customerOnAdmin.body.error.code, "FORBIDDEN");

    const staffOnAdmin = await api().then((request) =>
      request.get("/api/v1/admin/auth/me").set("Authorization", staffBearer),
    );
    assert.equal(staffOnAdmin.status, 200);
  });
});