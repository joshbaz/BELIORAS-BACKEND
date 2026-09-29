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
  enabled = env.rateLimiting,
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

/**
 * Two limiters, because one cannot be both specific and fair.
 *
 * The account limiter is the one a person actually runs into, and it is keyed
 * by *account and IP together*. Keying by IP alone — which is what this used to
 * do — makes the lockout communal: everyone behind one office connection shares
 * a bucket, so a colleague's run of mistyped passwords locks out the person who
 * typed theirs correctly, for the length of the window. Keying by account alone
 * fixes that and creates the opposite problem, where anyone can lock a known
 * address out of their own account by guessing at it from anywhere.
 *
 * The pair is the smallest key that is neither: a bucket belongs to one account
 * from one address, so it is spent by that combination and no other.
 *
 * The IP limiter is the counterweight. It exists because a password spray walks
 * *many* accounts from one source, which the per-account buckets never notice —
 * each is a fresh key — so something has to count attempts per source. It is
 * deliberately loose, and generous by design: it is here to make a spray
 * impractical, not to be the thing a person runs into.
 */
export function createAuthLimiter({
  enabled = env.rateLimiting,
  limit = 10,
  ipLimit = 60,
  windowMs = 15 * 60 * 1000,
} = {}) {
  if (!enabled) return noop;

  const byAccount = rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    // `ipKeyGenerator` rather than `req.ip`, which is the library's requirement
    // for correctly bucketing a whole IPv6 range.
    keyGenerator: (req) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      return email ? `${email}|${ipKeyGenerator(req.ip)}` : ipKeyGenerator(req.ip);
    },
    handler: envelopeHandler(),
  });

  const byIp = rateLimit({
    windowMs,
    limit: ipLimit,
    standardHeaders: false,
    legacyHeaders: false,
    handler: envelopeHandler(),
  });

  return (req, res, next) => byAccount(req, res, (err) => (err ? next(err) : byIp(req, res, next)));
}

/**
 * Limiter for the session refresh.
 *
 * Loose, and keyed by IP because it has to run before `authenticate` — the
 * refresh token is an httpOnly cookie, so there is no account to read yet.
 *
 * A refresh is not a guessing surface: a valid cookie cannot be brute-forced,
 * and reuse of a spent one is already caught by the token-reuse check, which is
 * the control that matters. So this exists only to stop a runaway client
 * hammering, and is set well clear of what a person or a busy office actually
 * uses. It was previously 20, which a handful of tabs booting at once could
 * reach.
 */
export function createRefreshLimiter({
  enabled = env.rateLimiting,
  limit = 60,
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
  enabled = env.rateLimiting,
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