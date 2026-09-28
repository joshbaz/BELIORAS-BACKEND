/* Role Guard */

import { ApiError } from "../../../core/ApiError.js";

/**
 * The server's first enforced capability check.
 *
 * Until now `role` was stored and echoed but never acted on: the dashboard
 * decided what a person could see, and the browser decided what they could do.
 * This is the server side of that line — for staff management only, which is
 * the one place where "the client hides the button" is not good enough, because
 * hiding it stops nobody with a network tab open.
 *
 * Must run AFTER `authenticate` and `requireBoundary`: it reads `req.user`, and
 * it means "a signed-in member of this realm who holds one of these roles", so
 * both of those have to have held already.
 *
 * A 403 here is deliberately uniform and role-agnostic in wording. It tells a
 * caller they may not do this; it does not confirm which roles exist.
 */
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) throw new ApiError("Please sign in to continue.", 401);
    if (!allowed.includes(req.user.role)) {
      throw new ApiError("You do not have permission to do that.", 403);
    }
    next();
  };
}
