/* Dashboard Sections */

/**
 * The dashboard's sections, as permissions — the server's copy of the client's
 * `utils/permissions.js`. Sections that only report (`readOnly`) stop at view.
 * Keep the two lists the same: a section the server does not know is one no
 * role can be given.
 */
export const SECTIONS = [
  { id: "overview", readOnly: true },
  { id: "products" },
  { id: "inventory" },
  { id: "categories" },
  { id: "sizes" },
  { id: "mega-menu" },
  { id: "reviews" },
  { id: "orders" },
  { id: "transactions", readOnly: true },
  { id: "customers", readOnly: true },
  { id: "reports", readOnly: true },
  { id: "discounts" },
  { id: "home" },
  { id: "newsletter" },
  { id: "team" },
  { id: "activity", readOnly: true },
  { id: "shipping" },
  { id: "settings" },
];

export const LEVELS = ["none", "view", "edit"];
const RANK = { none: 0, view: 1, edit: 2 };
export const rank = (level) => RANK[level] ?? 0;

/** A role's level for one section. The locked Administrator always edits. */
export function levelIn(role, section) {
  if (!role) return "none";
  if (role.locked) return "edit";
  const level = role.permissions?.[section] ?? "none";
  const def = SECTIONS.find((s) => s.id === section);
  return def?.readOnly && level === "edit" ? "view" : level;
}
