/* Rate Limiters */

import rateLimit from "express-rate-limit";
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