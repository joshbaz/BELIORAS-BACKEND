/* Redis Client */

import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  // Log but don't crash — degraded operation is better than total outage.
  // checkSession falls back to DB when Redis is unavailable.
  console.error("[redis] connection error:", err.message);
});
