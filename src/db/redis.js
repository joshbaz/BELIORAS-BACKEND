/* Redis Client */

import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../core/logger.js";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  // Log but don't crash — degraded operation is better than total outage.
  // checkSession falls back to DB when Redis is unavailable.
  logger.warn({ err }, "Redis connection error — session cache degraded to DB reads");
});
