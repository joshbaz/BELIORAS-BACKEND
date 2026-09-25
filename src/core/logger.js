/* Logger */

import pino from "pino";
import pinoHttp from "pino-http";
import { env } from "../config/env.js";

/**
 * Structured JSON logger. In development, uses pino-pretty for human-readable
 * output (if available); in production, emits pure JSON for log aggregators
 * like Datadog, GCP Logging, etc.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.isDevelopment && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
    },
  }),
});

/**
 * HTTP request logger middleware.
 * Attaches `req.log` (a child logger with the requestId bound) so any code
 * downstream can call `req.log.info(...)` with full context automatically.
 */
export function httpLogger() {
  return pinoHttp({
    logger,
    // Bind the existing requestId (already stamped by requestId middleware)
    // so every log line for this request carries it.
    genReqId: (req) => req.requestId,
    // Keep the log level for 4xx quiet in dev; 5xx always at error.
    customLogLevel: (req, res) => {
      if (res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    // Omit the full body from logs — just capture method, url, status, ms.
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        requestId: req.id,
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}
