/* Request Id */

import { randomUUID } from "node:crypto";

const HEADER = "x-request-id";

export function requestId(req, res, next) {
  const id = req.headers[HEADER] ?? randomUUID();
  req.requestId = id;
  res.setHeader(HEADER, id);
  next();
}