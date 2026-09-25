/* Auth Service */

import bcrypt from "bcryptjs";
import ms from "ms";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens.js";
import { publicUser } from "./guards.js";
import * as sessionCache from "./sessionCache.js";

const SALT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract the caller's IP and User-Agent from a request for audit/session storage. */
export function requestMeta(req) {
  const ip =
    (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) ??
    req.socket?.remoteAddress ??
    null;
  const userAgent = req.headers["user-agent"] ?? null;
  return { ip, userAgent };
}

/** Append an entry to the audit log — fire-and-forget, never throws. */
async function audit(userId, realm, action, meta = {}) {
  try {
    await prisma.auditLog.create({ data: { userId, realm, action, ...meta } });
  } catch (err) {
    console.error("[audit] failed to write log:", err.message);
  }
}

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

export async function register({ realm, name, email, password }, meta = {}) {
  const existing = await prisma.user.findUnique({ where: { realm_email: { realm, email } } });
  if (existing) throw new ApiError("An account with this email already exists.", 409);

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({ data: { realm, name, email, passwordHash } });

  const session = await issueSession(user, meta);
  await audit(user.id, realm, "REGISTER", meta);
  return session;
}

export async function login({ realm, email, password }, meta = {}) {
  const user = await prisma.user.findUnique({ where: { realm_email: { realm, email } } });
  if (!user) throw new ApiError("Invalid email or password.", 401);

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) throw new ApiError("Invalid email or password.", 401);

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

export async function updatePreferences(userId, preferences) {
  const user = await prisma.user.update({ where: { id: userId }, data: { preferences } });
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