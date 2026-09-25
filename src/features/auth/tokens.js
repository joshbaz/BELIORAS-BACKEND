/* Jwt And Refresh Cookie Helpers */

import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import ms from "ms";
import { env } from "../../config/env.js";
import { config } from "../../config/index.js";

export function signAccessToken(user) {
  return jwt.sign(
    { realm: user.realm, tv: user.tokenVersion },
    env.JWT_ACCESS_SECRET,
    { subject: user.id, expiresIn: env.ACCESS_TOKEN_TTL, algorithm: "HS256" },
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { realm: user.realm, jti: randomUUID() },
    env.JWT_REFRESH_SECRET,
    { subject: user.id, expiresIn: env.REFRESH_TOKEN_TTL, algorithm: "HS256" },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function refreshCookieBase(realm) {
  const { name, ...options } = config.cookie.refresh;
  return { name: name(realm), options };
}

export function setRefreshCookie(res, realm, token) {
  const { name, options } = refreshCookieBase(realm);
  res.cookie(name, token, { ...options, maxAge: ms(env.REFRESH_TOKEN_TTL) });
}

export function clearRefreshCookie(res, realm) {
  const { name, options } = refreshCookieBase(realm);
  res.clearCookie(name, options);
}