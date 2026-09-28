/* Rate Limiters */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { env } from "../config/env.js";
import { codeFor } from "../core/ApiError.js";

function noop(req, res, next) {
  next();
}

function envelopeHandler() {
  return (req, res, _next) => {
    res.status(429).json({
      error: {
        code: codeFor(429),
        message: "Too many requests, please try again later.",
        requestId: req.requestId,
      },
    });
  };
}

/** App-wide baseline limiter, applied to every request. */
export function createGlobalLimiter({
  enabled = env.RATE_LIMIT_ENABLED,
  limit = 300,
  windowMs = 15 * 60 * 1000,
  skip,
} = {}) {
  if (!enabled) return noop;
  const limiter = rateLimit({
    windowMs,
    limit,
    ...(skip ? { skip } : {}),
    standardHeaders: true,
    legacyHeaders: false,
    handler: envelopeHandler(),
  });
  return limiter;
}

/** Strict limiter for credential endpoints (register, login). */
export function createAuthLimiter({
  enabled = env.RATE_LIMIT_ENABLED,
  limit = 10,
  windowMs = 15 * 60 * 1000,
} = {}) {
  if (!enabled) return noop;
  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: envelopeHandler(),
  });
  return limiter;
}

/** Slightly looser limiter for the refresh endpoint. */
export function createRefreshLimiter({
  enabled = env.RATE_LIMIT_ENABLED,
  limit = 20,
  windowMs = 15 * 60 * 1000,
} = {}) {
  if (!enabled) return noop;
  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: envelopeHandler(),
  });
  return limiter;
}

/**
 * Limiter for change-password.
 *
 * Keyed by account, not by IP. The surface this protects is a stolen access
 * token being used to guess the *current* password one account at a time, and an
 * IP counter is the wrong shape for that: everyone behind one office NAT shares
 * a bucket, so ten wrong guesses by a colleague lock the legitimate person out
 * for fifteen minutes, while an attacker rotating addresses walks past it.
 *
 * It therefore has to run *after* `authenticate` — before it, there is no
 * account to key on. The IP fallback covers the window where a request arrives
 * with a token that does not verify, which costs a signature check and nothing
 * more. The service's own compare against the stored hash is still what actually
 * stops a guess; this just makes a sweep of one account impractical.
 */
export function createPasswordLimiter({
  enabled = env.RATE_LIMIT_ENABLED,
  limit = 10,
  windowMs = 15 * 60 * 1000,
} = {}) {
  if (!enabled) return noop;
  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
    handler: envelopeHandler(),
  });
  return limiter;
}