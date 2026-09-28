/* Auth Controller */

import { config } from "../../../config/index.js";
import { ApiError } from "../../../core/ApiError.js";
import { publicUser } from "../../../features/auth/guards.js";
import * as auth from "../../../features/auth/auth.service.js";
import { clearRefreshCookie, setRefreshCookie } from "../../../features/auth/tokens.js";

// The realm is now determined by the router boundary (req.realm) 
// or the authenticated user (req.user.realm), not by client headers.
function responseFor(res, session) {
  const { user, accessToken, refreshToken } = session;
  setRefreshCookie(res, user.realm, refreshToken);
  return { user, accessToken };
}

export async function register(req, res) {
  // Inject the boundary realm into the payload before passing to the service
  const session = await auth.register({ ...req.body, realm: req.realm }, auth.requestMeta(req));
  res.status(201).json({ data: responseFor(res, session) });
}

export async function login(req, res) {
  const session = await auth.login({ ...req.body, realm: req.realm }, auth.requestMeta(req));
  res.json({ data: responseFor(res, session) });
}

export async function refreshSession(req, res) {
  const realm = req.realm;
  const refreshToken = req.cookies[config.cookie.refresh.name(realm)];
  if (!refreshToken) throw new ApiError("Please sign in to continue.", 401);

  const session = await auth.refresh({ realm, refreshToken }, auth.requestMeta(req));
  res.json({ data: responseFor(res, session) });
}

export async function logout(req, res) {
  // If the user is authenticated, use their realm. Otherwise fallback to the route boundary.
  const realm = req.user ? req.user.realm : req.realm;
  await auth.logout({ realm, refreshToken: req.cookies[config.cookie.refresh.name(realm)] }, auth.requestMeta(req));
  clearRefreshCookie(res, realm);
  res.status(204).end();
}

export async function logoutAll(req, res) {
  const realm = req.user ? req.user.realm : req.realm;
  await auth.logoutAll({ realm, refreshToken: req.cookies[config.cookie.refresh.name(realm)] }, auth.requestMeta(req));
  clearRefreshCookie(res, realm);
  res.status(204).end();
}

export async function getMe(req, res) {
  res.json({ data: publicUser(req.user) });
}

export async function updatePreferences(req, res) {
  const user = await auth.updatePreferences(req.user.id, req.body.preferences);
  res.json({ data: user });
}

/** GET /auth/sessions — list all active sessions for the authenticated user. */
export async function getSessions(req, res) {
  const sessions = await auth.listSessions(req.user.id);
  res.json({ data: sessions });
}

/** DELETE /auth/sessions/:sessionId — revoke a single session. */
export async function revokeSession(req, res) {
  await auth.revokeSession(req.user.id, req.params.sessionId);
  res.status(204).end();
}

// ---------------------------------------------------------------------------
// Staff management
// ---------------------------------------------------------------------------

/** GET /auth/staff — the Team roster. */
export async function listStaff(req, res) {
  res.json({ data: await auth.listStaff() });
}

/**
 * POST /auth/staff — create an account with a temporary password.
 *
 * The temporary password comes back in the response because the admin has to
 * pass it on and there is nowhere else to get it. That is a deliberate,
 * one-time disclosure to someone who is already a super-admin and is about to
 * hand it over; it is not a read-back capability, and the account cannot be
 * used until its owner rotates it.
 */
export async function createStaff(req, res) {
  res.status(201).json({ data: await auth.createStaff(req.body, auth.requestMeta(req)) });
}

/**
 * PATCH /auth/staff/:id/role — change someone's role.
 *
 * The caller is passed through to the service rather than assumed: the rules
 * about whose role may change, and whose may not, depend on who is asking, and
 * only the service knows them. A controller that read `req.user.id` and dropped
 * it would be a place where that decision quietly became a constant.
 */
export async function updateStaffRole(req, res) {
  const user = await auth.updateStaffRole(req.params.id, req.body.role, req.user, auth.requestMeta(req));
  res.json({ data: user });
}

/**
 * PATCH /auth/staff/:id/status — suspend or restore an account.
 *
 * "Remove access" in the roster. The response is the updated account so the
 * caller can settle its cache from the server's own answer rather than from the
 * state it hoped for.
 */
export async function setStaffStatus(req, res) {
  const user = await auth.setStaffStatus(req.params.id, req.body.status, req.user, auth.requestMeta(req));
  res.json({ data: user });
}

/** POST /auth/change-password — replace the caller's own password. */
export async function changePassword(req, res) {
  const realm = req.user.realm;
  const refreshToken = req.cookies[config.cookie.refresh.name(realm)];
  const user = await auth.changePassword(req.user.id, req.body, refreshToken);
  res.json({ data: user });
}