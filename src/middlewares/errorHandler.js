/* Error Handler */

import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError, codeFor } from "../core/ApiError.js";
import { logger } from "../core/logger.js";

function fieldErrors(error) {
  const errors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    errors[key] = errors[key] ?? issue.message;
  }
  return errors;
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const requestId = req.requestId;
  let status;
  let code;
  let message;
  let details;

  if (err instanceof ApiError) {
    ({ status, code, message } = err);
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = "BAD_REQUEST";
    message = "Validation failed.";
    details = { fieldErrors: fieldErrors(err) };
  } else if (err?.name === "TokenExpiredError") {
    status = 401;
    code = "UNAUTHORIZED";
    message = "Your session has expired. Please sign in again.";
  } else if (err?.name === "JsonWebTokenError") {
    status = 401;
    code = "UNAUTHORIZED";
    message = "Invalid session.";
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      status = 409;
      code = "CONFLICT";
      message = "That already exists.";
    } else {
      status = 500;
      code = "INTERNAL_ERROR";
      message = "Something went wrong.";
    }
  } else {
    status = 500;
    code = "INTERNAL_ERROR";
    message = "Something went wrong.";
  }

  if (status >= 500) logger.error({ err, requestId }, "Unhandled server error");

  res.status(status).json({
    error: {
      code: code ?? codeFor(status),
      message,
      ...(details ? { details } : {}),
      requestId,
    },
  });
}