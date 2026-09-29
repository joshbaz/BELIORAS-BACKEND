/* Audit */

import { prisma } from "../../db/prisma.js";
import { logger } from "../../core/logger.js";

/**
 * Writing the activity trail.
 *
 * Lived inside `auth.service.js`, which meant the only feature that could audit
 * anything was auth — a size guide write would have had to duplicate it. It is
 * here now so any feature can record what happened.
 */

/** Extract the caller's IP and User-Agent from a request for audit/session storage. */
export function requestMeta(req) {
  const ip =
    (req.headers["x-forwarded-for"]?.split(",")[0]?.trim()) ??
    req.socket?.remoteAddress ??
    null;
  const userAgent = req.headers["user-agent"] ?? null;
  return { ip, userAgent };
}

/**
 * Append an entry to the audit log — fire-and-forget, never throws.
 *
 * A failed audit must not fail the write it describes: the caller has already
 * changed the data, and reporting an error there would invite a retry of work
 * that actually succeeded. The failure is logged instead.
 *
 * `meta` is spread into the row, and the model has both scalar `ip`/`userAgent`
 * columns and a `Json` column literally named `meta` — so a caller that has
 * detail to record nests it: `audit(id, "staff", "X", { ...req, meta: {...} })`.
 */
export async function audit(userId, realm, action, meta = {}) {
  try {
    await prisma.auditLog.create({ data: { userId, realm, action, ...meta } });
  } catch (err) {
    logger.error({ err }, "audit log write failed");
  }
}
