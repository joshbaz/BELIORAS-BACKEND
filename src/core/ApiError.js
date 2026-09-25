/* Api Error */

const CODES = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE",
  429: "RATE_LIMITED",
};

export class ApiError extends Error {
  constructor(message, status = 400, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options.code ?? CODES[status] ?? "INTERNAL_ERROR";
    this.details = options.details;
    this.expose = true;
  }
}

export function codeFor(status) {
  return CODES[status] ?? "INTERNAL_ERROR";
}