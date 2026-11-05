/* Section Access Guard */

import { ApiError } from "../../../core/ApiError.js";
import { levelFor } from "../../../features/roles/roles.service.js";
import { rank } from "../../../features/roles/sections.js";

/**
 * Lets a request through when the caller's role gives at least the asked
 * level in one of the named sections: `requireAccess("products:edit")`, or
 * `requireAccess("transactions:view", "orders:view")` for an any-of.
 *
 * This is the dashboard's own permission model, read from the roles table —
 * so editing a role under Team → Roles changes what the server allows, and a
 * role created there works on the server straight away. Use after
 * `authenticate` and `requireBoundary`.
 */
export function requireAccess(...needs) {
  const wanted = needs.map((n) => {
    const [section, level = "view"] = n.split(":");
    return { section, level };
  });
  return async (req, res, next) => {
    if (!req.user) throw new ApiError("Please sign in to continue.", 401);
    for (const { section, level } of wanted) {
      if (rank(await levelFor(req.user.role, section)) >= rank(level)) return next();
    }
    throw new ApiError("You do not have permission to do that.", 403);
  };
}
