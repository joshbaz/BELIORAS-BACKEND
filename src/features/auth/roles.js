/* Auth Roles */

import { ApiError } from "../../core/ApiError.js";

/**
 * Dashboard role ids, mirroring the client's catalogue
 * (`client/src/data/rolesSeed.js`).
 *
 * Only two are load-bearing here. `super-admin` is what the staff bootstrap and
 * the seed script mint — the one role that must exist and cannot itself be
 * granted or revoked, and therefore the one future staff-management routes will
 * gate on. `customer` is what a storefront account holds. Every other id
 * ("staff", "finance", "support", "content", "developer") is a real role in the
 * dashboard, but the server only stores and echoes it — the per-section
 * capability matrix behind those ids lives in the client and is not enforced
 * here yet.
 */

export const ROLES = {
  SUPER_ADMIN: "super-admin",
  CUSTOMER: "customer",
};

/** The role a new account gets in each realm. */
export function defaultRoleFor(realm) {
  return realm === "staff" ? ROLES.SUPER_ADMIN : ROLES.CUSTOMER;
}

export function isSuperAdmin(user) {
  return user?.role === ROLES.SUPER_ADMIN;
}

/**
 * Guard for the role an admin is allowed to hand out.
 *
 * The full catalogue is the client's to edit, so the server deliberately does
 * not hold a list to check membership against — it only enforces the two
 * things it can know for certain. `super-admin` is the one role that cannot be
 * granted, because it is the role that grants roles: an admin who can mint a
 * peer can be made redundant, and the "cannot itself be granted or revoked"
 * rule the bootstrap depends on stops holding. The length cap is just a bound
 * on what gets written to the row.
 */
export function assertAssignableRole(role) {
  const id = typeof role === "string" ? role.trim() : "";
  if (!id) throw new ApiError("Choose a role for this account.", 400);
  if (id.length > 60) throw new ApiError("That role id is not a valid role.", 400);
  if (id === ROLES.SUPER_ADMIN) {
    throw new ApiError("The Administrator role cannot be granted.", 400);
  }
  return id;
}
