/* Session Guards */

import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../core/ApiError.js";
import * as sessionCache from "./sessionCache.js";
import { verifyAccessToken } from "./tokens.js";

/**
 * Strips anything sensitive from a User before it leaves the server.
 *
 * `tokenVersion` goes as well as the password hash: it is the revocation
 * counter, an internal value that happens to be on the same row, and a browser
 * that reads it has no use for it. `role` deliberately stays — the dashboard
 * needs it to know who it is talking to, and the capability rules that will
 * eventually gate it are enforced here, not in the browser.
 */
export function publicUser(user) {
  const { passwordHash, tokenVersion, ...rest } = user;
  void tokenVersion;
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
    // A suspended account is refused even when the cache still holds it as
    // active. Suspension moves `tokenVersion` and clears the cache, so this is
    // not the mechanism — it is the guarantee that a suspended account has no
    // access no matter which path a token arrived by, including one minted in
    // the window between the update and the cache being dropped.
    if (cached.user.status === "suspended") {
      throw new ApiError("This account has been suspended.", 403);
    }
    return cached.user;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.realm !== payload.realm || user.tokenVersion !== payload.tv) {
    throw new ApiError("Please sign in to continue.", 401);
  }
  if (user.status === "suspended") {
    throw new ApiError("This account has been suspended.", 403);
  }

  const safe = publicUser(user);
  await sessionCache.set(payload.sub, { user: safe, tv: user.tokenVersion });
  return safe;
}