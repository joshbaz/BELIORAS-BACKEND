/* Navigation Schema */

import { z } from "zod";

/**
 * The menu tree as the dashboard saves it.
 *
 * The server checks the shape and the rules it can see on its own: names,
 * unique addresses, and addresses the shop already uses. Whether each node's
 * `target` still points at a real category, filter or product needs the
 * catalogue — products and the filter taxonomy still live in the browser — so
 * that check stays in the dashboard, which runs it before every save.
 *
 * Nodes are `passthrough()` so presentation fields the client adds (`i18nKey`,
 * `aliases`, a tile's `image`) survive a round trip without this schema
 * having to know about each one.
 */

/** Addresses the storefront already uses. Mirrors the client's `RESERVED_SLUGS`. */
export const RESERVED_SLUGS = new Set([
  "product", "checkout", "account", "wishlist", "search", "login", "signup",
  "forgot-password", "reset-password", "atelier", "dashboard", "faq", "about-us", "contact-us",
  "order-tracking", "hair-length-guide", "shoe-size-guide", "privacy-policy",
  "terms-of-service", "shipping-policy", "return-and-refund-policy",
  "cookie-policy", "whats-new", "newsletter",
]);

const id = z.string().trim().min(1).max(120);
const slug = z.string().trim().min(1).max(300).regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/, "That address is not valid.");
const url = z.string().trim().min(1).max(301).startsWith("/");
const target = z.object({ kind: z.string().min(1).max(40) }).passthrough();

const leaf = z
  .object({ id, label: z.string().trim().min(1, "A link needs a name.").max(120), slug, url, target })
  .passthrough();

const section = z
  .object({
    id,
    title: z.string().trim().min(1, "Every column needs a heading.").max(120),
    items: z.array(leaf).min(1, "A column needs at least one link.").max(60),
  })
  .passthrough();

const tile = z
  .object({
    id,
    title: z.string().trim().min(1, "A feature tile needs a title.").max(120),
    target,
    // An uploaded photo, or none (the tile then uses a product's photo). Never
    // a `blob:`/`data:` URL, which only exists in the browser that made it.
    image: z
      .string()
      .max(2000)
      .refine((v) => /^(https?:\/\/|\/(?!\/))/i.test(v), "Upload the tile's photo again — it was never saved to the server.")
      .nullable()
      .optional(),
  })
  .passthrough();

const root = z
  .object({
    id,
    label: z.string().trim().min(1, "Every menu item needs a name.").max(80),
    slug,
    url,
    target,
    sections: z.array(section).max(12).default([]),
    tiles: z.array(tile).max(6).default([]),
  })
  .passthrough();

/** `PUT /navigation`: the whole tree, and the version it was edited from. */
export const updateNavigationSchema = z
  .object({
    items: z.array(root).max(20),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine(({ items }, ctx) => {
    const problem = (message) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["items"] });
    const ids = new Set();
    const urls = new Set();
    for (const r of items) {
      if (RESERVED_SLUGS.has(r.slug)) problem(`“${r.label}” would use /${r.slug}, which the shop already uses.`);
      for (const node of [r, ...r.sections, ...r.sections.flatMap((s) => s.items), ...r.tiles]) {
        if (ids.has(node.id)) problem(`Two parts of the menu share the id ${node.id}.`);
        ids.add(node.id);
      }
      for (const node of [r, ...r.sections.flatMap((s) => s.items)]) {
        if (urls.has(node.url)) problem(`Two links use the address ${node.url}. Rename one of them.`);
        urls.add(node.url);
      }
    }
  });
