/* Auth Service */

import bcrypt from "bcryptjs";
import ms from "ms";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { audit, requestMeta } from "../audit/audit.js";
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens.js";
import { ROLES, defaultRoleFor, assertAssignableRole } from "./roles.js";
import { publicUser } from "./guards.js";
import { assertWithinReach, getRole } from "../roles/roles.service.js";
import * as sessionCache from "./sessionCache.js";
import { randomBytes } from "node:crypto";
import { queueEmail } from "../emails/emails.service.js";

const SALT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Re-exported so `auth.requestMeta(req)` keeps working at the controller.
export { requestMeta };

/**
 * Issue a new access + refresh token pair for the user.
 * Creates a Session document (per-device) and returns the public user.
 */
async function issueSession(user, { ip, userAgent } = {}) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await prisma.session.create({
    data: {
      userId: user.id,
      realm: user.realm,
      refreshHash: hashToken(refreshToken),
      refreshExpiry: new Date(Date.now() + ms(env.REFRESH_TOKEN_TTL)),
      ip,
      userAgent,
    },
  });

  await sessionCache.del(user.id);
  return { user: publicUser(user), accessToken, refreshToken };
}

/** Delete all sessions for a user and bump tokenVersion to kill outstanding access tokens. */
async function revokeAllFor(user) {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
    }),
  ]);
  await sessionCache.del(user.id);
}

// ---------------------------------------------------------------------------
// Public service functions
// ---------------------------------------------------------------------------

/**
 * Create an account and sign it straight in.
 *
 * On the staff boundary this is the one-time bootstrap: it counts staff users
 * and refuses once one exists, so the single account it mints is the shop's
 * first Administrator (`super-admin`) — which is what makes the gate safe, and
 * why a seed script exists for repeatable environments.
 */
export async function register({ realm, name, email, password }, meta = {}) {
  if (realm === "staff") {
    const staffCount = await prisma.user.count({ where: { realm: "staff" } });
    if (staffCount > 0) {
      throw new ApiError("A staff account already exists.", 409);
    }
  }

  const existing = await prisma.user.findUnique({ where: { realm_email: { realm, email } } });
  if (existing) throw new ApiError("An account with this email already exists.", 409);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({ data: { realm, name, email, passwordHash, role: defaultRoleFor(realm) } });

  const session = await issueSession(user, meta);
  await audit(user.id, realm, "REGISTER", meta);
  if (realm === "customer") {
    await queueEmail(prisma, { type: "welcome", to: user.email, subject: "Welcome to Belioras", data: { name: user.name } });
  }
  return session;
}

/**
 * The caller's own name, phone and email. Changing the email — where order
 * confirmations and reset links go — needs the current password, checked here
 * rather than in a separate request, so a wrong password cannot half-apply.
 */
export async function updateProfile(userId, { name, phone, email, currentPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError("Please sign in to continue.", 401);

  const nextEmail = email && email !== user.email ? email : null;
  if (nextEmail) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new ApiError("Enter your current password to change your email.", 401, {
        details: { fieldErrors: { currentPassword: "Your current password is incorrect." } },
      });
    }
    const taken = await prisma.user.findUnique({ where: { realm_email: { realm: user.realm, email: nextEmail } } });
    if (taken) throw new ApiError("An account with this email already exists.", 409);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined ? { name: name || null } : {}),
      ...(phone !== undefined ? { phone: phone || null } : {}),
      ...(nextEmail ? { email: nextEmail } : {}),
    },
  });
  await sessionCache.del(userId);
  const fields = Object.entries({ name, phone, email }).filter(([, v]) => v !== undefined).map(([k]) => k);
  await audit(userId, user.realm, "PROFILE_UPDATE", { meta: { fields } });
  return publicUser(updated);
}

const RESET_TTL_MINUTES = 60;

/**
 * Starts a password reset. Always answers the same, whether or not the address
 * has an account, so the form cannot be used to find out who shops here.
 *
 * Only the token's hash is stored. The link goes out by email; until a mail
 * provider is connected it sits in the outbox, and outside production the
 * link is included there so the flow can be tested.
 */
export async function requestPasswordReset({ realm, email }, meta = {}) {
  const user = await prisma.user.findUnique({ where: { realm_email: { realm, email } } });
  if (!user || user.status === "suspended") return;

  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) },
  });
  const link = `${env.CLIENT_ORIGIN}/${realm === "staff" ? "atelier/" : ""}reset-password?token=${token}`;
  await queueEmail(prisma, {
    type: "password-reset",
    to: user.email,
    subject: "Reset your Belioras password",
    data: { expiresInMinutes: RESET_TTL_MINUTES, ...(env.NODE_ENV !== "production" ? { link } : {}) },
  });
  await audit(user.id, realm, "PASSWORD_RESET_REQUEST", meta);
}

/**
 * Finishes a reset: sets the new password, uses up the link, and signs the
 * account out everywhere — whoever asked for the reset may not be the only
 * one who had the old password.
 */
export async function confirmPasswordReset({ realm, token, password }, meta = {}) {
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  const user = reset ? await prisma.user.findUnique({ where: { id: reset.userId } }) : null;
  if (!reset || reset.usedAt || reset.expiresAt < new Date() || !user || user.realm !== realm) {
    throw new ApiError("This reset link has expired or was already used. Ask for a new one.", 400);
  }
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  await sessionCache.del(user.id);
  await audit(user.id, realm, "PASSWORD_RESET", meta);
}

/** Shoppers with an account, newest first, for the dashboard's Customers page. */
export async function listCustomers() {
  const users = await prisma.user.findMany({ where: { realm: "customer" }, orderBy: { createdAt: "desc" } });
  return users.map(publicUser);
}

export async function login({ realm, email, password }, meta = {}) {
  const user = await prisma.user.findUnique({ where: { realm_email: { realm, email } } });
  // Failed attempts are recorded for the Activity page's "Failed sign-ins" —
  // with the account when there is one, the typed email either way. The answer
  // to the caller stays the same, so it still reveals nothing.
  const fail = async () => {
    await audit(user?.id ?? null, realm, "LOGIN_FAILED", { ...meta, meta: { email } });
    return new ApiError("Invalid email or password.", 401);
  };
  if (!user) throw await fail();

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) throw await fail();

  // Checked after the password so a suspended account cannot be used to probe
  // whether an address exists, and said plainly rather than as the uniform
  // sign-in failure: a colleague who has just been removed needs to know it was
  // deliberate, and there is nothing to brute-force here — they already know
  // their own password.
  if (user.status === "suspended") {
    throw new ApiError("This account has been suspended.", 403);
  }

  const session = await issueSession(user, meta);
  await audit(user.id, realm, "LOGIN", meta);
  return session;
}

export async function refresh({ realm, refreshToken }, meta = {}) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError("Please sign in to continue.", 401);
  }
  if (payload.realm !== realm) throw new ApiError("Please sign in to continue.", 401);

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.realm !== realm) throw new ApiError("Please sign in to continue.", 401);

  // Suspension deletes every session row, so this is normally unreachable — but
  // it is the difference between "access ends because a row was deleted" and
  // "a suspended account cannot hold a session", and only one of those stays
  // true if the deletion is ever reordered or made best-effort.
  if (user.status === "suspended") {
    await revokeAllFor(user);
    throw new ApiError("This account has been suspended.", 403);
  }

  const presented = hashToken(refreshToken);
  const existingSession = await prisma.session.findUnique({ where: { refreshHash: presented } });

  if (!existingSession || existingSession.userId !== user.id) {
    // Token reuse detected — revoke everything for this user.
    await revokeAllFor(user);
    await audit(user.id, realm, "LOGOUT_ALL", { ...meta, meta: { reason: "token_reuse_detected" } });
    throw new ApiError("Please sign in to continue.", 401);
  }

  if (existingSession.refreshExpiry < new Date()) {
    await prisma.session.delete({ where: { id: existingSession.id } });
    throw new ApiError("Please sign in to continue.", 401);
  }

  // Rotate: delete old session, issue a new one.
  await prisma.session.delete({ where: { id: existingSession.id } });
  const session = await issueSession(user, meta);
  await audit(user.id, realm, "REFRESH", meta);
  return session;
}

export async function logout({ realm, refreshToken }, meta = {}) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }
  if (payload.realm !== realm) return;

  const presented = hashToken(refreshToken);
  const session = await prisma.session.findUnique({ where: { refreshHash: presented } });
  if (!session) return;

  await prisma.session.delete({ where: { id: session.id } });
  await sessionCache.del(session.userId);
  await audit(session.userId, realm, "LOGOUT", meta);
}

export async function logoutAll({ realm, refreshToken }, meta = {}) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }
  if (payload.realm !== realm) return;

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return;

  await revokeAllFor(user);
  await audit(user.id, realm, "LOGOUT_ALL", meta);
}

// ---------------------------------------------------------------------------
// Staff management
// ---------------------------------------------------------------------------

/**
 * Create a staff account on someone else's behalf, with a temporary password.
 *
 * Deliberately does NOT call `issueSession`. The caller is an admin, not this
 * new person, and minting a session here would put a usable refresh cookie in
 * the admin's browser for an account they have never signed in as. The
 * temporary password is flagged instead, so the account is only usable after its
 * owner rotates it.
 *
 * The caller is expected to have been through `requireAccess("team:edit")`; the
 * role argument is validated here rather than trusted, because `super-admin` is
 * the role that grants roles.
 */
/** A role id that exists and that `actor` may hand out (no further than their own reach). */
async function assignable(role, actor) {
  const roleId = assertAssignableRole(role);
  const record = await getRole(roleId);
  if (!record) throw new ApiError("Choose a role that exists.", 400);
  if (actor) await assertWithinReach(record, actor);
  return roleId;
}

export async function createStaff({ name, email, role, password }, meta = {}, actor = null) {
  const roleId = await assignable(role, actor);

  const existing = await prisma.user.findUnique({ where: { realm_email: { realm: "staff", email } } });
  if (existing) throw new ApiError("A staff account with this email already exists.", 409);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { realm: "staff", name, email, passwordHash, role: roleId, mustChangePassword: true },
  });

  // The account hash is never returned — but the admin does need to hand over
  // the temporary password, and it exists nowhere else, so say so explicitly
  // rather than leaving them to guess whether it was kept.
  await audit(user.id, "staff", "STAFF_CREATE", { ...meta, meta: { role: roleId, by: actor?.id ?? null } });
  return { user: publicUser(user), temporaryPassword: password };
}

/** Every staff account, newest first, for the Team roster. */
export async function listStaff() {
  const users = await prisma.user.findMany({
    where: { realm: "staff" },
    orderBy: { createdAt: "desc" },
  });
  return users.map(publicUser);
}

/**
 * Change a staff member's role.
 *
 * Two targets are refused, and each is a way the team could end up with nobody
 * able to administer it:
 *
 *  - your own account, because demoting the person holding the button removes
 *    the only route to undo it;
 *  - any `super-admin` row, in either direction. `super-admin` is the role that
 *    grants roles and `assertAssignableRole` already refuses to hand it out, so
 *    there is never a second one to promote first; letting the roster demote one
 *    would be the only way to reach an empty admin set. It is checked in both
 *    directions because a row that is already `super-admin` must not be
 *    "changed" to a role it cannot hold.
 *
 * A suspended account is refused too, because changing the role of someone who
 * cannot sign in is a way to lose track of what they will come back to.
 *
 * `tokenVersion` is deliberately NOT bumped. The role is not in the access
 * token — only `sub`, `realm` and `tv` are — so the session stays valid and the
 * person is not signed out of a job they still have. The session cache is
 * dropped because it holds a copy of the user row, role included, and would
 * otherwise go on answering with the old one.
 */
export async function updateStaffRole(targetId, role, actor, meta = {}) {
  const roleId = await assignable(role, actor);
  const target = await requireStaffTarget(targetId, actor);

  if (target.role === ROLES.SUPER_ADMIN) {
    throw new ApiError("The Administrator role cannot be granted or removed.", 403);
  }
  if (target.role === roleId) return publicUser(target);

  if (target.status === "suspended") {
    throw new ApiError("Restore this account before changing its role.", 409);
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { role: roleId },
  });

  await sessionCache.del(target.id);
  await audit(target.id, "staff", "STAFF_ROLE_CHANGE", {
    ...meta,
    meta: { from: target.role, to: roleId, by: actor.id },
  });
  return publicUser(updated);
}

/**
 * Suspend or restore a staff account — "remove access" in the roster.
 *
 * Suspension is not a demotion. It ends access now, by three things at once: the
 * sign-in refuses a suspended account, every existing access token dies because
 * `tokenVersion` moves, and every stored session row is deleted so no refresh
 * token can mint a replacement. Demoting alone would leave the person able to
 * sign straight back in, which is the opposite of what the button says.
 *
 * The last active super-admin is refused, and so is your own account, for the
 * same reason `updateStaffRole` refuses both: the team must never be one click
 * away from having no administrator. `requireStaffTarget` is what turns "aimed
 * at yourself" into an error; the `super-admin` check is here because this is
 * the one call that would end an administrator's access.
 */
export async function setStaffStatus(targetId, status, actor, meta = {}) {
  if (status !== "suspended" && status !== "active") {
    throw new ApiError("That is not a status an account can be put into.", 400);
  }

  const target = await requireStaffTarget(targetId, actor);
  if (target.role === ROLES.SUPER_ADMIN && status === "suspended") {
    throw new ApiError("The Administrator role cannot be suspended here.", 403);
  }
  if (target.status === status) return publicUser(target);

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { status, suspendedAt: status === "suspended" ? new Date() : null },
  });

  // Only a suspension revokes. Restoring someone should not sign them out of
  // the device they are sitting at — they were not there while they were away.
  if (status === "suspended") await revokeAllFor(target);

  await audit(target.id, "staff", "STAFF_STATUS_CHANGE", {
    ...meta,
    meta: { status, by: actor.id },
  });
  return publicUser(updated);
}

/**
 * Resolve the row a staff-management call is aimed at, and refuse the two
 * mistakes that are easy to make from a table: aiming at yourself, and aiming
 * at a row that is not a staff account at all (a customer id would otherwise
 * sail through every role check below and come back as a Prisma error).
 *
 * The id is shape-checked before it is used. `id` is an ObjectId, and handing
 * the driver something that is not one is a BSON parse failure — which arrives
 * as a 500 from a URL a person typed or a client built, on a route that has
 * nothing wrong with it. A malformed id is a missing row as far as this service
 * is concerned, and saying so is both true and cheap.
 */
async function requireStaffTarget(targetId, actor) {
  if (targetId === actor.id) {
    throw new ApiError("You cannot change your own account here.", 403);
  }
  if (typeof targetId !== "string" || !/^[0-9a-f]{24}$/i.test(targetId)) {
    throw new ApiError("That staff account no longer exists.", 404);
  }
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || target.realm !== "staff") {
    throw new ApiError("That staff account no longer exists.", 404);
  }
  return target;
}

/**
 * Replace the caller's own password, clearing the temporary-password flag.
 *
 * The session in use is kept and every other session for the account is
 * dropped, because a temporary password has by definition been shared with
 * whoever set it. `tokenVersion` is deliberately NOT bumped: that is the
 * blunt instrument that kills the caller's own access token too, and the whole
 * point here is to leave them signed in. The stale session cache entry is
 * dropped so the next request re-reads the new flag from the database.
 */
export async function changePassword(userId, { currentPassword, newPassword }, currentRefreshToken) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError("Please sign in to continue.", 401);

  // Both failures are attributable to one box on the form, so they say which.
  // A message with nowhere to go is a message the person reads at the bottom of
  // a form and has to work out for themselves — and "your current password is
  // incorrect" is exactly the kind of answer that should never have to be
  // inferred. The sign-in form deliberately withholds this; here there is no
  // equivalent ambiguity, because the caller has already proven who they are.
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ApiError("Your current password is incorrect.", 401, {
      details: { fieldErrors: { currentPassword: "Your current password is incorrect." } },
    });
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new ApiError("Choose a password you haven't used here before.", 400, {
      details: { fieldErrors: { newPassword: "Choose a password you haven't used here before." } },
    });
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Keep the caller's own device, drop the rest.
  const presented = currentRefreshToken ? hashToken(currentRefreshToken) : null;
  const found = presented ? await prisma.session.findUnique({ where: { refreshHash: presented } }) : null;
  const keep = found && found.userId === userId ? found : null;

  const updated = await prisma.$transaction(async (tx) => {
    if (keep) {
      await tx.session.deleteMany({ where: { userId, id: { not: keep.id } } });
    }
    return tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
  });

  await sessionCache.del(userId);
  await audit(userId, user.realm, "PASSWORD_CHANGE");
  return publicUser(updated);
}

export async function updatePreferences(userId, preferences) {  const user = await prisma.user.update({ where: { id: userId }, data: { preferences } });
  await sessionCache.del(userId);
  await audit(userId, user.realm, "PREFERENCES_UPDATE");
  return publicUser(user);
}

/** Returns all active sessions for a user (for "active devices" UI). */
export async function listSessions(userId) {
  return prisma.session.findMany({
    where: { userId },
    select: { id: true, ip: true, userAgent: true, createdAt: true, refreshExpiry: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Revoke a single session by ID (user must own it). */
export async function revokeSession(userId, sessionId) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) {
    throw new ApiError("Session not found.", 404);
  }
  await prisma.session.delete({ where: { id: sessionId } });
  // No need to bust sessionCache — access tokens still valid until tokenVersion bump.
}