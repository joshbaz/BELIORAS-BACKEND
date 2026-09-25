/* Jwt Guard */

import { ApiError } from "../../../core/ApiError.js";
import { checkSession } from "../../../features/auth/guards.js";

/**
 * Thin HTTP adapter: extracts the Bearer access token and delegates the actual
 * verification (and session caching) to `checkSession` in the auth feature, so
 * it stays identical for HTTP and socket traffic.
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new ApiError("Please sign in to continue.", 401);

  req.user = await checkSession(token);
  next();
}