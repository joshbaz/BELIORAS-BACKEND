/* Entry Point */

import "dotenv/config";
import http from "node:http";
import { createApp } from "./app.js";
import { config, env } from "./config/index.js";
import { prisma } from "./db/prisma.js";
import { redis } from "./db/redis.js";
import { logger } from "./core/logger.js";
import { initSocket } from "./sockets/index.js";

const app = createApp();
const server = http.createServer(app);
initSocket(server);

async function main() {
  // MongoDB
  try {
    await prisma.$connect();
    logger.info({ url: env.DATABASE_URL }, "MongoDB connected");
  } catch (err) {
    logger.error({ err }, "Could not connect to MongoDB. Is the container running? (docker compose up -d mongodb)");
    process.exit(1);
  }

  // Redis
  try {
    await redis.connect();
    logger.info({ url: env.REDIS_URL }, "Redis connected");
  } catch (err) {
    logger.warn({ err }, "Redis unavailable — session cache degraded to DB reads");
    // Non-fatal: the app works without Redis, just slower.
  }

  server.listen(env.PORT, config.http.host, () => {
    logger.info(
      { url: `http://${config.http.host}:${env.PORT}${config.api.root}${config.api.version}` },
      "Belioras API started",
    );
    logger.info("Socket.IO attached");
  });
}

function shutdown(signal) {
  logger.info({ signal }, "Shutdown signal received");
  server.close(async () => {
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main();