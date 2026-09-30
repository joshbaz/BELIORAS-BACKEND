/* Size List Seed */

/**
 * The shipped size list.
 *
 * These twelve entries and, above all, these twelve ids are the seed's real
 * content. The ids are load-bearing in three places that no later migration may
 * quietly invalidate:
 *
 *   - a product's `colorways[].stock` is an object *keyed by size id*, so a
 *     changed id does not move a stock count, it orphans it
 *   - `?size=eu38,m` is a bookmarked, shareable storefront URL
 *   - `sizeChartKind.js` decides which of the three guides a product needs by
 *     pattern-matching the id: `/^eu\d+$/i` is footwear, `/^(xs|s|m|l|xl|xxl)$/i`
 *     is garment. That is a fragile signal to depend on, and it is the reason
 *     `sizeChartKindFor` has the comment it has — but it holds only because
 *     these ids look the way they look.
 *
 * So the ids below are copied verbatim from the client bundle rather than
 * re-slugged, and the seed never derives an id from a name. A size added later
 * gets a slug for readability, which keeps it working with that same regex
 * *if* it happens to be a letter size or an `euNN` — a constraint to keep in
 * mind, not a rule the model can enforce, and the reason a future guide-routing
 * field is worth having.
 *
 * `position` is explicit rather than implied by array order, because the order
 * sizes appear in is the order a shopper reads them in the facet and the order
 * `CategoryDialog` re-sorts a category's ticked sizes into. Storing it means a
 * reordering is a deliberate act rather than a side effect of insertion.
 *
 * Note what is deliberately *not* reconciled here: the garment guide has an `XXL`
 * row with no size in this list, and this list has EU sizes and One Size that
 * the garment guide has no row for. A guide is a measurement table and this is a
 * list of sizes; they are separate resources on purpose, and forcing them into
 * agreement here would mean editing a size name rewrites a guide.
 */
export const SEED_SIZES = [
  { id: "xs", name: "XS", position: 0 },
  { id: "s", name: "S", position: 1 },
  { id: "m", name: "M", position: 2 },
  { id: "l", name: "L", position: 3 },
  { id: "xl", name: "XL", position: 4 },
  { id: "eu36", name: "EU 36 · UK 3 · US 5", position: 5 },
  { id: "eu37", name: "EU 37 · UK 4 · US 6", position: 6 },
  { id: "eu38", name: "EU 38 · UK 5 · US 7", position: 7 },
  { id: "eu39", name: "EU 39 · UK 6 · US 8", position: 8 },
  { id: "eu40", name: "EU 40 · UK 6.5 · US 9", position: 9 },
  { id: "eu41", name: "EU 41 · UK 7.5 · US 10", position: 10 },
  { id: "one-size", name: "One Size", position: 11 },
];
