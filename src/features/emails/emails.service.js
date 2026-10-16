/* Email Outbox Service */

import { prisma } from "../../db/prisma.js";

/**
 * What the shop would send, queued until a mail provider is connected — the
 * same outbox the dashboard's Activity page shows. Written by the order flows
 * here; the emails the browser still owns (sign-ups, newsletter) stay in its
 * own outbox and the dashboard shows both.
 */

export async function queueEmail(db, { type, to, subject, orderId = null, data = {} }) {
  if (!to) return null;
  return db.email.create({ data: { type, to, subject, orderId, data } });
}

function present(e) {
  return { id: e.id, type: e.type, to: e.to, subject: e.subject, orderId: e.orderId, data: e.data, status: e.status, createdAt: e.createdAt };
}

export async function listEmails({ orderId } = {}) {
  const rows = await prisma.email.findMany({ where: orderId ? { orderId } : {}, orderBy: { createdAt: "desc" }, take: 2000 });
  return rows.map(present);
}
