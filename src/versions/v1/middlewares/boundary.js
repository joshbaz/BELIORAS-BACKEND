/* Realm Injection & Enforcement */

import { ApiError } from "../../../core/ApiError.js";

/**
 * Injects a specific realm into the request context. 
 * Used for public routes (like login) so the controller knows which 
 * boundary is being accessed without relying on headers or body payloads.
 */
export function setBoundary(realm) {
  return (req, res, next) => {
    req.realm = realm;
    next();
  };
}

/**
 * Enforces that the authenticated user belongs to the specified realm.
 * Must be used AFTER the `authenticate` middleware.
 */
export function requireBoundary(req, res, next) {
  if (!req.user || req.user.realm !== req.realm) {
    throw new ApiError("Access denied to this service boundary.", 403);
  }
  next();
}
