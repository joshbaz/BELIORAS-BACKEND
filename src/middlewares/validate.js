/* Zod Validate */

import { ApiError } from "../core/ApiError.js";

/**
 * Parses a request slice against a zod schema and replaces it with the parsed
 * (stripped and coerced) value. A failed parse throws the ZodError, which the
 * error handler shapes into `{ error: { details: { fieldErrors } } }`.
 */
export function validate(schema, source = "body") {
  return (req, res, next) => {
    req[source] = schema.parse(req[source]);
    next();
  };
}
/**
 * Like `validate`, but answers with the first problem as the error message
 * (`400`, with `fieldErrors` still in details). For dashboard forms that show
 * the message in a toast, where "Validation failed." tells nobody what to fix.
 */
export function validateWithReason(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (result.success) {
      req[source] = result.data;
      return next();
    }
    const fieldErrors = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      fieldErrors[key] = fieldErrors[key] ?? issue.message;
    }
    const [first] = result.error.issues;
    next(new ApiError(first?.message ?? "Validation failed.", 400, { details: { fieldErrors } }));
  };
}
