/* Auth Routes */

import { Router } from "express";
import {
  getMe,
  getSessions,
  login,
  logout,
  logoutAll,
  refreshSession,
  register,
  revokeSession,
  updatePreferences,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/authenticate.js";
import { createAuthLimiter, createRefreshLimiter } from "../../../middlewares/rateLimit.js";
import { validate } from "../../../middlewares/validate.js";
import { loginSchema, preferencesSchema, registerSchema } from "../schemas/auth.schema.js";

const router = Router();

const authLimiter = createAuthLimiter();
const refreshLimiter = createRefreshLimiter();

// Public
router.post("/register", authLimiter, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/refresh", refreshLimiter, refreshSession);
router.post("/logout", logout);
router.post("/logout-all", logoutAll);

// Authenticated
router.get("/me", authenticate, getMe);
router.patch("/me/preferences", authenticate, validate(preferencesSchema), updatePreferences);

// Session management (per-device)
router.get("/sessions", authenticate, getSessions);
router.delete("/sessions/:sessionId", authenticate, revokeSession);

export default router;