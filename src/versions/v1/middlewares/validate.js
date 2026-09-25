/* Zod Validate */

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