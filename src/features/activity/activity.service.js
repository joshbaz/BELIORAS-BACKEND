/* Staff Activity Service */

import { prisma } from "../../db/prisma.js";

/**
 * The dashboard's Activity page, read from the server's audit log — the one
 * record every change on this server already writes, with who, when and from
 * where. It used to be a list each browser kept for itself, so an admin saw
 * only what had been done in their own browser.
 *
 * Each audit action belongs to a dashboard section and reads as one sentence,
 * built here from the action and its details. Staff actions only; token
 * refreshes are left out as noise. Staff-account changes record the person they
 * happened to, with the actor in `meta.by`.
 */

const SECTION = {
  LOGIN: "auth", LOGIN_FAILED: "auth", LOGOUT: "auth", LOGOUT_ALL: "auth", PASSWORD_CHANGE: "auth",
  PASSWORD_RESET_REQUEST: "auth", PASSWORD_RESET: "auth", PROFILE_UPDATE: "auth", PREFERENCES_UPDATE: "auth", REGISTER: "auth",
  STAFF_CREATE: "team", STAFF_ROLE_CHANGE: "team", STAFF_STATUS_CHANGE: "team", ROLE_CREATE: "team", ROLE_UPDATE: "team", ROLE_DELETE: "team",
  SIZE_GUIDE_UPDATE: "sizes", SIZE_GUIDE_RESET: "sizes", SIZE_CREATE: "sizes", SIZE_RENAME: "sizes", SIZE_DELETE: "sizes", SIZE_RESET: "sizes",
  CATEGORY_CREATE: "categories", CATEGORY_UPDATE: "categories", CATEGORY_DELETE: "categories", CATEGORY_REORDER: "categories", CATEGORY_RESET: "categories",
  COLOR_CREATE: "categories", COLOR_UPDATE: "categories", COLOR_DELETE: "categories", COLOR_RESET: "categories",
  NAVIGATION_UPDATE: "mega-menu", NAVIGATION_RESET: "mega-menu",
  PRODUCT_CREATE: "products", PRODUCT_UPDATE: "products", PRODUCT_DELETE: "products", PRODUCT_RESTORE: "products",
  STOCK_ADJUST: "inventory", STOCK_RECEIVE: "inventory", STOCK_ORDER: "orders", INVENTORY_SETTINGS: "inventory",
  ORDER_STATUS: "orders", ORDER_CANCEL: "orders", ORDER_REFUND: "orders", ORDER_RESEND: "orders",
  COUPON_CREATE: "discounts", COUPON_UPDATE: "discounts", COUPON_DELETE: "discounts",
  SETTINGS_UPDATE: "settings",
  REVIEW_PUBLISH: "reviews", REVIEW_HIDE: "reviews", REVIEW_REPLY: "reviews",
  NEWSLETTER_UPDATE: "newsletter", CAMPAIGN_SAVE: "newsletter", CAMPAIGN_SEND: "newsletter", CAMPAIGN_DELETE: "newsletter",
  SUBSCRIBER_UNSUBSCRIBE: "newsletter", SUBSCRIBER_ERASE: "newsletter",
  MODEL_CREATE: "sizes", MODEL_UPDATE: "sizes", MODEL_DELETE: "sizes", TAXONOMY_UPDATE: "categories",
};

const STATUS_WORD = { shipped: "shipped", "to-review": "delivered", cancelled: "cancelled", refunded: "refunded" };
const money = (n) => `€${Number(n ?? 0).toFixed(2)}`;

/** One sentence for an entry. `subject` is the person a staff-account change was about. */
export function describe(action, m = {}, subject = null) {
  const who = subject?.name ?? subject?.email ?? "an account";
  switch (action) {
    case "LOGIN": return "Signed in";
    case "LOGIN_FAILED": return `Failed sign-in${m.email ? ` as ${m.email}` : ""}`;
    case "LOGOUT": return "Signed out";
    case "LOGOUT_ALL": return "Signed out everywhere";
    case "PASSWORD_CHANGE": return "Changed their password";
    case "PASSWORD_RESET_REQUEST": return "Asked for a password reset";
    case "PASSWORD_RESET": return "Reset their password";
    case "PROFILE_UPDATE": return "Updated their profile";
    case "PREFERENCES_UPDATE": return "Updated their preferences";
    case "REGISTER": return "Created the account";
    case "STAFF_CREATE": return `Added ${who} to the team${m.role ? ` as ${m.role}` : ""}`;
    case "STAFF_ROLE_CHANGE": return `Changed ${who}'s role from ${m.from} to ${m.to}`;
    case "STAFF_STATUS_CHANGE": return m.status === "suspended" ? `Removed ${who}'s access` : `Restored ${who}'s access`;
    case "ROLE_CREATE": return `Created role ${m.id}`;
    case "ROLE_UPDATE": return `Updated role ${m.id}`;
    case "ROLE_DELETE": return `Deleted role ${m.id}`;
    case "SIZE_GUIDE_UPDATE": return `Saved the ${m.type} size guide`;
    case "SIZE_GUIDE_RESET": return "Reset the size guides";
    case "SIZE_CREATE": return `Added size ${m.name}`;
    case "SIZE_RENAME": return `Renamed size ${m.from} to ${m.to}`;
    case "SIZE_DELETE": return `Deleted size ${m.name}`;
    case "SIZE_RESET": return "Reset the size list";
    case "CATEGORY_CREATE": return `Created category ${m.name}`;
    case "CATEGORY_UPDATE": return m.from && m.from !== m.to ? `Renamed category ${m.from} to ${m.to}` : `Updated category ${m.to ?? m.id}`;
    case "CATEGORY_DELETE": return `Deleted category ${m.name}`;
    case "CATEGORY_REORDER": return "Reordered categories";
    case "CATEGORY_RESET": return "Reset categories";
    case "COLOR_CREATE": return `Added colour ${m.name}`;
    case "COLOR_UPDATE": return `Updated colour ${m.to ?? m.id}`;
    case "COLOR_DELETE": return `Deleted colour ${m.name}`;
    case "COLOR_RESET": return "Reset colours";
    case "NAVIGATION_UPDATE": return "Saved the mega menu";
    case "NAVIGATION_RESET": return "Restored the original mega menu";
    case "PRODUCT_CREATE": return `Created “${m.name}”`;
    case "PRODUCT_UPDATE": return `Updated “${m.name}”${m.fields?.length === 1 && m.fields[0] === "status" ? " (status)" : ""}`;
    case "PRODUCT_DELETE": return `Deleted “${m.name}”`;
    case "PRODUCT_RESTORE": return `Restored “${m.name}”`;
    case "STOCK_ADJUST": return `Stock ${m.mode === "set" ? "count set to" : m.mode === "add" ? "added" : "removed"} ${m.quantity} (${m.reason}) for ${m.productId}`;
    case "STOCK_RECEIVE": return `Received ${m.quantity} into each of ${m.variants} variant${m.variants === 1 ? "" : "s"}`;
    case "STOCK_ORDER": return m.reason === "sold" ? `Took order ${m.orderId}'s pieces off the shelf` : `Returned ${m.units} piece${m.units === 1 ? "" : "s"} from order ${m.orderId} to stock`;
    case "INVENTORY_SETTINGS": return `Set the low-stock level to ${m.lowStockThreshold}`;
    case "ORDER_STATUS": return `Marked order ${m.id} ${STATUS_WORD[m.to] ?? m.to}`;
    case "ORDER_CANCEL": return `Cancelled order ${m.id}${m.refunded ? ` and refunded ${money(m.refunded)}` : ""}`;
    case "ORDER_REFUND": return `Refunded ${money(m.amount)} on order ${m.id} (${m.creditNote})`;
    case "ORDER_RESEND": return `Resent the order confirmation for ${m.id}`;
    case "COUPON_CREATE": return `Created coupon ${m.code}`;
    case "COUPON_UPDATE": return `Updated coupon ${m.code}`;
    case "COUPON_DELETE": return `Deleted coupon ${m.code}`;
    case "SETTINGS_UPDATE": return (m.sections ?? []).every((s) => s === "shipping") ? "Saved shipping settings" : "Saved store settings";
    case "REVIEW_PUBLISH": return `Published review ${m.id}`;
    case "REVIEW_HIDE": return `Hid review ${m.id}`;
    case "REVIEW_REPLY": return `Replied to review ${m.id}`;
    case "NEWSLETTER_UPDATE": return "Updated the welcome email";
    case "CAMPAIGN_SAVE": return m.scheduled ? `Scheduled campaign ${m.id}` : `Saved campaign ${m.id}`;
    case "CAMPAIGN_SEND": return `Sent campaign ${m.id} to ${m.recipients}`;
    case "CAMPAIGN_DELETE": return `Deleted campaign ${m.id}`;
    case "SUBSCRIBER_UNSUBSCRIBE": return `Unsubscribed subscriber ${m.id}`;
    case "SUBSCRIBER_ERASE": return `Erased subscriber ${m.id}`;
    case "MODEL_CREATE": return `Added fit model ${m.name}`;
    case "MODEL_UPDATE": return `Updated fit model ${m.name}`;
    case "MODEL_DELETE": return `Deleted fit model ${m.name}`;
    case "TAXONOMY_UPDATE": return "Updated the colour families";
    default: return action.toLowerCase().replace(/_/g, " ");
  }
}

const ACTED_BY_OTHER = new Set(["STAFF_CREATE", "STAFF_ROLE_CHANGE", "STAFF_STATUS_CHANGE"]);

/** Staff activity, newest first, shaped as the Activity page reads it. */
export async function listActivity({ limit = 2000 } = {}) {
  const rows = await prisma.auditLog.findMany({
    where: { realm: "staff", action: { not: "REFRESH" } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const ids = new Set();
  for (const r of rows) {
    if (r.userId) ids.add(r.userId);
    if (r.meta?.by) ids.add(r.meta.by);
  }
  const users = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, email: true, role: true } })).map((u) => [u.id, u]),
  );

  return rows.map((r) => {
    const m = r.meta ?? {};
    const byOther = ACTED_BY_OTHER.has(r.action);
    const actor = byOther ? users.get(m.by) ?? null : users.get(r.userId) ?? null;
    const subject = byOther ? users.get(r.userId) ?? null : null;
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      actorEmail: actor?.email ?? (r.action === "LOGIN_FAILED" ? m.email ?? null : null),
      actorRole: actor?.role ?? null,
      section: SECTION[r.action] ?? "settings",
      summary: describe(r.action, m, subject),
      outcome: r.action === "LOGIN_FAILED" ? "failed" : "ok",
      ip: r.ip ?? null,
    };
  });
}

/** When each member of staff last signed in, keyed by user id. */
export async function lastSignIns() {
  const rows = await prisma.auditLog.findMany({
    where: { realm: "staff", action: "LOGIN" },
    orderBy: { createdAt: "desc" },
    select: { userId: true, createdAt: true },
    take: 5000,
  });
  const map = {};
  for (const r of rows) if (r.userId && !map[r.userId]) map[r.userId] = r.createdAt.toISOString();
  return map;
}
