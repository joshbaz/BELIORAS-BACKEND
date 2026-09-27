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