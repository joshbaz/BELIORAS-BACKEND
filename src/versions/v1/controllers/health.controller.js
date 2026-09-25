/* Health Controller */

import { prisma } from "../../../db/prisma.js";
import { redis } from "../../../db/redis.js";

export async function getHealth(req, res) {
  const [dbStatus, redisStatus] = await Promise.all([
    prisma.$runCommandRaw({ ping: 1 }).then(() => "connected").catch(() => "unavailable"),
    redis.ping().then(() => "connected").catch(() => "unavailable"),
  ]);

  const overall = dbStatus === "connected" && redisStatus === "connected" ? "ok" : "degraded";

  res.status(overall === "ok" ? 200 : 503).json({
    data: {
      status: overall,
      db: dbStatus,
      redis: redisStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
  });
}