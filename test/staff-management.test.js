/* Staff Management Tests */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { api, cookieDirective, refreshCookie, uniqueEmail } from "./helpers.js";

const TEMP_PASSWORD = "Temporary123";

/**
 * These tests cover the first routes whose access the server actually decides,
 * plus the temporary-password rotation that goes with them. They seed their own
 * super-admin rather than leaning on `auth.test.js`, whose bootstrap deliberately
 * wipes the staff table — test files must not depend on each other's order.
 */

const created = [];

async function seedStaff({ role = "content", password = TEMP_PASSWORD, mustChangePassword = false } = {}) {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  const user = await prisma.user.create({
    data: {
      realm: "staff",
      name: "Seeded Staff",
      email,
      role,
      passwordHash: bcrypt.hashSync(password, 10),
      mustChangePassword,
    },
  });
  return { user, email, password };
}

/**
 * An account in the state `POST /staff` leaves it in: signed in, but owing a
 * password change. The rotation tests use this rather than a plain seeded user,
 * because a flagged account is the only thing that can actually reach the
 * change-password screen.
 */
function seedPendingPassword() {
  return seedStaff({ mustChangePassword: true });
}

async function login(email, password) {
  return api().then((request) => request.post("/api/v1/admin/auth/login").send({ email, password }));
}

function authenticateAs(res) {
  return `Bearer ${res.body.data.accessToken}`;
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

describe("staff management authorisation", () => {
  it("refuses the roster to a staff account that is not a super-admin", async () => {
    const { email, password } = await seedStaff({ role: "support" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) => request.get("/api/v1/admin/auth/staff").set("Authorization", bearer));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "FORBIDDEN");
  });

  it("refuses account creation to a staff account that is not a super-admin", async () => {
    const { email, password } = await seedStaff({ role: "content" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/staff")
        .set("Authorization", bearer)
        .send({ name: "Back Door", email: uniqueEmail("sneaky"), role: "staff", password: "Backdoor123" }),
    );
    assert.equal(res.status, 403);
  });

  it("refuses a customer token even on the staff roster", async () => {
    const email = uniqueEmail("customer");
    created.push(email);
    const res = await api().then((request) =>
      request
        .post("/api/v1/storefront/auth/register")
        .send({ email, name: "Shopper", password: "Customer123" }),
    );

    const res2 = await api().then((request) =>
      request.get("/api/v1/admin/auth/staff").set("Authorization", authenticateAs(res)),
    );
    assert.equal(res2.status, 403);
  });

  it("serves the roster to a super-admin", async () => {
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) => request.get("/api/v1/admin/auth/staff").set("Authorization", bearer));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.every((u) => u.realm === "staff"));
  });
});

describe("creating a staff account", () => {
  it("creates the account flagged for password change, with no session", async () => {
    const { email: adminEmail, password: adminPassword } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(adminEmail, adminPassword));
    const { prisma } = await import("../src/db/prisma.js");

    const before = await prisma.session.count();
    const newEmail = uniqueEmail("new");
    created.push(newEmail);

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/staff")
        .set("Authorization", bearer)
        .send({ name: "Rowan Vale", email: newEmail, role: "content", password: "HandedOver1" }),
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.mustChangePassword, true);
    assert.equal(res.body.data.user.role, "content");
    assert.equal(res.body.data.user.passwordHash, undefined);
    assert.equal(res.body.data.user.tokenVersion, undefined);
    // The temporary password is handed back once, because the admin has to pass
    // it on and there is nowhere else to get it.
    assert.equal(res.body.data.temporaryPassword, "HandedOver1");

    // Creating an account must NOT sign that account in from the admin's browser.
    const after = await prisma.session.count();
    assert.equal(after, before, "expected no session to be created for the new account");
  });

  it("never hands out a session for the account it just created", async () => {
    const { email: adminEmail, password: adminPassword } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(adminEmail, adminPassword));
    const newEmail = uniqueEmail("nosession");
    created.push(newEmail);

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/staff")
        .set("Authorization", bearer)
        .send({ name: "No Session", email: newEmail, role: "staff", password: "HandedOver1" }),
    );

    assert.equal(res.headers["set-cookie"], undefined, "no refresh cookie should be set on create");
  });

  it("refuses to grant the Administrator role", async () => {
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));
    const newEmail = uniqueEmail("usurper");
    created.push(newEmail);

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/staff")
        .set("Authorization", bearer)
        .send({ name: "Usurper", email: newEmail, role: "super-admin", password: "HandedOver1" }),
    );

    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Administrator role cannot be granted/);
  });

  it("refuses a duplicate staff email", async () => {
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));
    const { user } = await seedStaff({ role: "finance" });

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/staff")
        .set("Authorization", bearer)
        .send({ name: "Clash", email: user.email, role: "staff", password: "HandedOver1" }),
    );

    assert.equal(res.status, 409);
  });

  it("reports each bad field on the create form", async () => {
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/staff")
        .set("Authorization", bearer)
        .send({ name: "", email: "not-an-email", role: "", password: "short" }),
    );

    assert.equal(res.status, 400);
    const fields = res.body.error.details.fieldErrors;
    assert.equal(fields.name, "Enter their name.");
    assert.equal(fields.email, "Enter a valid email address.");
    assert.equal(fields.role, "Choose a role.");
    assert.equal(fields.password, "Password must be at least 8 characters.");
  });
});

describe("temporary password rotation", () => {
  it("signs in with the temporary password but keeps the account flagged", async () => {
    const { email, password } = await seedPendingPassword();
    const res = await login(email, password);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.mustChangePassword, true);
    assert.ok(refreshCookie(res, "staff"), "expected a staff refresh cookie");
  });

  it("rejects a wrong current password", async () => {
    const { email, password } = await seedPendingPassword();
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/change-password")
        .set("Authorization", bearer)
        .send({ currentPassword: "NotMyPassword1", newPassword: "BrandNew123" }),
    );

    assert.equal(res.status, 401);
    assert.match(res.body.error.message, /current password is incorrect/);
    // The form has three boxes and the answer belongs to one of them. Without
    // the field named, the client can only render it as a form-wide message and
    // the person has to work out which password was rejected.
    assert.equal(
      res.body.error.details?.fieldErrors?.currentPassword,
      "Your current password is incorrect.",
    );
  });

  it("refuses to reuse the current password", async () => {
    const { email, password } = await seedPendingPassword();
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/change-password")
        .set("Authorization", bearer)
        .send({ currentPassword: password, newPassword: password }),
    );

    assert.equal(res.status, 400);
    assert.equal(res.body.error.details.fieldErrors.newPassword, "Choose a password you haven't used here before.");
  });

  it("clears the flag, kills the temporary password, and leaves the caller signed in", async () => {
    const { email, password } = await seedPendingPassword();
    const loginRes = await login(email, password);
    const bearer = authenticateAs(loginRes);

    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/change-password")
        .set("Authorization", bearer)
        .send({ currentPassword: password, newPassword: "BrandNew123" }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.mustChangePassword, false);
    assert.equal(res.body.data.passwordHash, undefined);

    // The old password is dead, the new one works, and the flag is gone on the
    // fresh login — otherwise the account would loop back to the same screen.
    const oldPassword = await login(email, password);
    assert.equal(oldPassword.status, 401);

    const newPassword = await login(email, "BrandNew123");
    assert.equal(newPassword.status, 200);
    assert.equal(newPassword.body.data.user.mustChangePassword, false);
  });

  it("keeps the caller's own refresh cookie working after rotation", async () => {
    const { email, password } = await seedPendingPassword();
    const loginRes = await login(email, password);

    await api().then((request) =>
      request
        .post("/api/v1/admin/auth/change-password")
        .set("Authorization", authenticateAs(loginRes))
        .send({ currentPassword: password, newPassword: "BrandNew123" }),
    );

    // Rotation must not sign the person out of the tab they are using.
    const res = await api().then((request) =>
      request.post("/api/v1/admin/auth/refresh").set("Cookie", cookieDirective(refreshCookie(loginRes, "staff"))),
    );
    assert.equal(res.status, 200);
  });

  it("drops the other sessions opened with the temporary password", async () => {
    const { email, password } = await seedPendingPassword();
    const { prisma } = await import("../src/db/prisma.js");

    // Two devices, both using the password that was handed out.
    const phone = await login(email, password);
    const laptop = await login(email, password);
    const user = await prisma.user.findUnique({ where: { realm_email: { realm: "staff", email } } });
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 2);

    await api().then((request) =>
      request
        .post("/api/v1/admin/auth/change-password")
        .set("Authorization", authenticateAs(phone))
        // The browser sends its refresh cookie here, and the service uses it to
        // tell "the session doing the changing" from "the other sessions using
        // the handed-out password". Without it there is no such thing as the
        // caller's own session, and the right answer is to drop them all.
        .set("Cookie", cookieDirective(refreshCookie(phone, "staff")))
        .send({ currentPassword: password, newPassword: "BrandNew123" }),
    );

    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 1);

    // The session that was not the caller's is no longer a usable refresh token.
    const stale = await api().then((request) =>
      request.post("/api/v1/admin/auth/refresh").set("Cookie", cookieDirective(refreshCookie(laptop, "staff"))),
    );
    assert.equal(stale.status, 401);
  });

  it("refuses to change a password without a session", async () => {
    const res = await api().then((request) =>
      request
        .post("/api/v1/admin/auth/change-password")
        .send({ currentPassword: TEMP_PASSWORD, newPassword: "BrandNew123" }),
    );
    assert.equal(res.status, 401);
  });
});

describe("changing a staff member's role", () => {
  it("changes the role and returns the updated account", async () => {
    const { user } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/role`).set("Authorization", bearer).send({ role: "finance" }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.role, "finance");

    const { prisma } = await import("../src/db/prisma.js");
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).role, "finance");
  });

  it("does not sign the member out — a role change is not a revocation", async () => {
    const { user, email: memberEmail, password: memberPassword } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const memberToken = authenticateAs(await login(memberEmail, memberPassword));
    await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/role`).set("Authorization", bearer).send({ role: "content" }),
    );

    // The token predates the role change and carries no role, so it must keep
    // working — and must now report the new one, which is the real assertion.
    const me = await api().then((request) => request.get("/api/v1/admin/auth/me").set("Authorization", memberToken));
    assert.equal(me.status, 200);
    assert.equal(me.body.data.role, "content");
  });

  it("refuses to grant the Administrator role", async () => {
    const { user } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/role`).set("Authorization", bearer).send({ role: "super-admin" }),
    );
    assert.equal(res.status, 400);
  });

  it("refuses to demote another Administrator", async () => {
    // Both accounts are written directly: `super-admin` cannot be granted
    // through the API, so the only way to have a second one — and therefore the
    // only way to reach this guard over HTTP — is to seed it.
    const target = await seedStaff({ role: "super-admin" });
    const { email: callerEmail, password: callerPassword } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(callerEmail, callerPassword));

    const res = await api().then((request) =>
      request
        .patch(`/api/v1/admin/auth/staff/${target.user.id}/role`)
        .set("Authorization", bearer)
        .send({ role: "support" }),
    );
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /Administrator role cannot be granted or removed/);

    // And it is refused in the other direction too, even though a super-admin
    // row cannot become one — the check is on the target, not the change.
    const promote = await api().then((request) =>
      request
        .patch(`/api/v1/admin/auth/staff/${target.user.id}/role`)
        .set("Authorization", bearer)
        .send({ role: "finance" }),
    );
    assert.equal(promote.status, 403);
  });

  it("refuses to change the caller's own role", async () => {
    const { user, email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/role`).set("Authorization", bearer).send({ role: "support" }),
    );
    assert.equal(res.status, 403);
  });

  it("refuses a role change on a suspended account", async () => {
    const { user } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));
    await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", bearer).send({ status: "suspended" }),
    );

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/role`).set("Authorization", bearer).send({ role: "finance" }),
    );
    assert.equal(res.status, 409);
  });

  it("refuses a role change to a staff account that is not a super-admin", async () => {
    const { user } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "finance" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/role`).set("Authorization", bearer).send({ role: "content" }),
    );
    assert.equal(res.status, 403);
  });

  it("refuses an unknown account", async () => {
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request
        .patch("/api/v1/admin/auth/staff/6ab96a21bed4869d7fd76b4c7/role")
        .set("Authorization", bearer)
        .send({ role: "finance" }),
    );
    assert.equal(res.status, 404);
  });

  it("treats a malformed id as a missing row, not a server error", async () => {
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    // `id` is an ObjectId. A string that is not one used to reach the driver and
    // come back as a 500, which blames the server for a URL a person typed.
    for (const bad of ["not-an-id", "12345", "../../etc/passwd", "6ab96a21bed4869d7fd76b4c"]) {
      const res = await api().then((request) =>
        request
          .patch(`/api/v1/admin/auth/staff/${encodeURIComponent(bad)}/role`)
          .set("Authorization", bearer)
          .send({ role: "finance" }),
      );
      assert.equal(res.status, 404, `${bad} should be 404, got ${res.status}`);
    }
  });
});

describe("suspending a staff account", () => {
  it("ends access now: token, refresh and sign-in all stop working", async () => {
    const { user, email: memberEmail, password: memberPassword } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const adminBearer = authenticateAs(await login(email, password));

    // The member is signed in and holding a session before the suspension.
    const memberToken = authenticateAs(await login(memberEmail, memberPassword));
    const signedIn = await api().then((request) => request.get("/api/v1/admin/auth/me").set("Authorization", memberToken));
    assert.equal(signedIn.status, 200);

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", adminBearer).send({ status: "suspended" }),
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "suspended");
    assert.ok(res.body.data.suspendedAt, "suspension is timestamped");

    // The access token they were holding is dead.
    const after = await api().then((request) => request.get("/api/v1/admin/auth/me").set("Authorization", memberToken));
    assert.equal(after.status, 401);

    // So is signing in, and so is every future attempt.
    const relogin = await login(memberEmail, memberPassword);
    assert.equal(relogin.status, 403);
    assert.match(relogin.body.error.message, /suspended/);
  });

  it("restores access without asking for a new password", async () => {
    const { user, email: memberEmail, password: memberPassword } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const adminBearer = authenticateAs(await login(email, password));

    await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", adminBearer).send({ status: "suspended" }),
    );
    const restored = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", adminBearer).send({ status: "active" }),
    );

    assert.equal(restored.status, 200);
    assert.equal(restored.body.data.status, "active");
    assert.equal(restored.body.data.suspendedAt, null, "the timestamp is cleared, not left behind");

    assert.equal((await login(memberEmail, memberPassword)).status, 200);
  });

  it("leaves the role alone, so a restore returns them to the same job", async () => {
    const { user } = await seedStaff({ role: "finance" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", bearer).send({ status: "suspended" }),
    );
    const { prisma } = await import("../src/db/prisma.js");
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).role, "finance");
  });

  it("refuses to suspend the caller's own account", async () => {
    const { user, email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", bearer).send({ status: "suspended" }),
    );
    assert.equal(res.status, 403);
  });

  it("refuses to suspend another Administrator", async () => {
    const other = await seedStaff({ role: "super-admin" });
    const { user } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(user.email, other.password));

    const res = await api().then((request) =>
      request
        .patch(`/api/v1/admin/auth/staff/${other.user.id}/status`)
        .set("Authorization", bearer)
        .send({ status: "suspended" }),
    );
    assert.equal(res.status, 403);
  });

  it("refuses a status the service does not have", async () => {
    const { user } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", bearer).send({ status: "banned" }),
    );
    assert.equal(res.status, 400);
  });

  it("refuses suspension to a staff account that is not a super-admin", async () => {
    const { user } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "developer" });
    const bearer = authenticateAs(await login(email, password));

    const res = await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", bearer).send({ status: "suspended" }),
    );
    assert.equal(res.status, 403);
  });

  it("shows a suspended account on the roster rather than hiding it", async () => {
    const { user } = await seedStaff({ role: "support" });
    const { email, password } = await seedStaff({ role: "super-admin" });
    const bearer = authenticateAs(await login(email, password));

    await api().then((request) =>
      request.patch(`/api/v1/admin/auth/staff/${user.id}/status`).set("Authorization", bearer).send({ status: "suspended" }),
    );

    const roster = await api().then((request) => request.get("/api/v1/admin/auth/staff").set("Authorization", bearer));
    const row = roster.body.data.find((u) => u.id === user.id);
    assert.ok(row, "a suspended account stays on the roster — it is a state, not a deletion");
    assert.equal(row.status, "suspended");
  });
});
