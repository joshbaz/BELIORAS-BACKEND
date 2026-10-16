/* Express App */

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import path from "node:path";
import helmet from "helmet";
import { config, env } from "./config/index.js";
import { httpLogger } from "./core/logger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { notFound } from "./middlewares/notFound.js";
import { createGlobalLimiter } from "./middlewares/rateLimit.js";
import { requestId } from "./middlewares/requestId.js";
import v1Routes from "./versions/v1/index.js";
import { LOCAL_PATH, storageMode } from "./features/uploads/uploads.service.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // requestId must be first so pino-http can bind it as the log request ID.
  app.use(requestId);
  app.use(httpLogger());

  // Health probes stay outside the global cap so monitoring can poll freely.
  app.use(createGlobalLimiter({ skip: (req) => req.method === "GET" && req.path === "/api/v1/health" }));

  app.get("/", (req, res) => {
    res.json({ data: { name: "Belioras API", version: "v1" } });
  });

  // Development uploads, when ImageKit is not configured. File names are random
  // and never reused, so they can be cached for good.
  if (storageMode() === "local") {
    app.use(LOCAL_PATH, express.static(path.resolve(env.UPLOAD_DIR), { immutable: true, maxAge: "365d", index: false }));
  }

  app.use(`${config.api.root}${config.api.version}`, v1Routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}