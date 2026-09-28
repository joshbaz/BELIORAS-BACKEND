/* Auth Routes */

import { Router } from "express";
import {
  changePassword,
  createStaff,
  getMe,
  getSessions,
  listStaff,
  login,
  logout,
  logoutAll,
  setStaffStatus,
  updateStaffRole,
  refreshSession,
  register,
  revokeSession,
  updatePreferences,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireBoundary } from "../middlewares/boundary.js";
import { requireRole } from "../middlewares/requireRole.js";
import { createAuthLimiter, createPasswordLimiter, createRefreshLimiter } from "../../../middlewares/rateLimit.js";
import { validate } from "../../../middlewares/validate.js";
import { ROLES } from "../../../features/auth/roles.js";
import {
  changePasswordSchema,
  loginSchema,
  preferencesSchema,
  registerSchema,
  staffCreateSchema,
  staffRoleSchema,
  staffStatusSchema,
} from "../schemas/auth.schema.js";

const router = Router();

const authLimiter = createAuthLimiter();
const refreshLimiter = createRefreshLimiter();
const passwordLimiter = createPasswordLimiter();

// Public
router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/refresh", refreshLimiter, refreshSession);
router.post("/logout", logout);
router.post("/logout-all", logoutAll);

// Authenticated
router.get("/me", authenticate, requireBoundary, getMe);
router.patch("/me/preferences", authenticate, requireBoundary, validate(preferencesSchema), updatePreferences);

// Password change — any signed-in member of this realm, and rate limited
// because it accepts a current password and so is a credential-guessing surface.
// The limiter is after `authenticate` on purpose: it counts guesses per account
// rather than per address, which is the shape the threat actually has.
router.post(
  "/change-password",
  authenticate,
  passwordLimiter,
  requireBoundary,
  validate(changePasswordSchema),
  changePassword,
);

// Session management (per-device)
router.get("/sessions", authenticate, requireBoundary, getSessions);
router.delete("/sessions/:sessionId", authenticate, requireBoundary, revokeSession);

// Staff management — super-admin only. This is the first route whose access the
// server actually decides; everything above it only asks who you are.
router.get("/staff", authenticate, requireBoundary, requireRole(ROLES.SUPER_ADMIN), listStaff);
router.post(
  "/staff",
  authenticate,
  requireBoundary,
  requireRole(ROLES.SUPER_ADMIN),
  validate(staffCreateSchema),
  createStaff,
);

// The two edits the roster offers on an existing account. Separate routes rather
// than one `PATCH /staff/:id` with an optional body: each has a different set of
// refusals, and merging them would mean a request could half-apply or arrive
// with nothing to do.
router.patch(
  "/staff/:id/role",
  authenticate,
  requireBoundary,
  requireRole(ROLES.SUPER_ADMIN),
  validate(staffRoleSchema),
  updateStaffRole,
);
router.patch(
  "/staff/:id/status",
  authenticate,
  requireBoundary,
  requireRole(ROLES.SUPER_ADMIN),
  validate(staffStatusSchema),
  setStaffStatus,
);

export default router;