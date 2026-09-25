/* Session Cache — Redis-backed */

import ms from "ms";
import { env } from "../../config/env.js";
import { redis } from "../../db/redis.js";

const TTL_S = Math.ceil(ms(env.SESSION_CACHE_TTL) / 1000);
const KEY = (userId) => `session:${userId}`;

/**
 * Redis-backed session cache that replaces the previous in-process Map.
 *
 * Same interface as before (get / set / del) so no call-sites changed.
 * TTL is enforced by Redis itself — no sweep timer needed.
 *
 * Falls back to undefined (cache miss) if Redis is unavailable, so
 * checkSession gracefully degrades to a DB read rather than crashing.
 */
export async function get(userId) {
  try {
    const raw = await redis.get(KEY(userId));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export async function set(userId, { user, tv }) {
  try {
    await redis.set(KEY(userId), JSON.stringify({ user, tv }), "EX", TTL_S);
  } catch {
    // Swallow — degraded to no-cache, not a crash.
  }
}

export async function del(userId) {
  try {
    await redis.del(KEY(userId));
  } catch {
    // Swallow — worst case the old entry expires naturally.
  }
}