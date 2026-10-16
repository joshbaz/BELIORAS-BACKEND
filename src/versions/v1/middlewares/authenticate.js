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
/**
 * For the routes a guest may use too (checkout, order tracking): with no token
 * the request goes on as a guest; with one, it must be a valid session in
 * this boundary — a bad or wrong-realm token is refused rather than quietly
 * treated as a guest, which would hide a real session problem.
 */
export async function optionalAuthenticate(req, res, next) {
  if (!req.headers.authorization) return next();
  req.user = await checkSession(req.headers.authorization.replace(/^Bearer /, ""));
  if (req.user.realm !== req.realm) throw new ApiError("Access denied to this service boundary.", 403);
  next();
}
