/* Session Guards */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import * as sessionCache from "./sessionCache.js";
import { verifyAccessToken } from "./tokens.js";

/** Strips anything sensitive from a User before it leaves the server. */
export function publicUser(user) {
  const { passwordHash, ...rest } = user;
  return rest;
}

/**
 * Verifies an access token and returns the caller's public user. The token
 * carries `tokenVersion`, and a logout-all bumps the user's stored version,
 * so a token minted before it is rejected here. Uses the session cache to
 * avoid a database read per request when the session is already trusted.
 */
export async function checkSession(token) {
  const payload = verifyAccessToken(token);

  const cached = await sessionCache.get(payload.sub);
  if (cached && cached.tv === payload.tv && cached.user.realm === payload.realm) {
    return cached.user;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.realm !== payload.realm || user.tokenVersion !== payload.tv) {
    throw new ApiError("Please sign in to continue.", 401);
  }

  const safe = publicUser(user);
  await sessionCache.set(payload.sub, { user: safe, tv: user.tokenVersion });
  return safe;
}