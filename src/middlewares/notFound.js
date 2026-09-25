/* Not Found */

import { ApiError } from "../core/ApiError.js";

export function notFound(req, res, next) {
  next(new ApiError(`No route for ${req.method} ${req.path}`, 404));
}