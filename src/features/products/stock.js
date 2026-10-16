/* Stock Rules */

/**
 * On hand, per piece and per variant, and the history rows a change makes.
 *
 * The same rules as the client's `inventory/variants.js` and `stockDiff.js`,
 * on purpose: the dashboard still previews counts with its copy, and the two
 * must agree on what "on hand" means or a preview and a save would differ.
 *
 * A piece is "tracked" when its colourways carry a `stock` map (colour × size).
 * An untracked piece is one number, `stock`, and its only variant is "*" "*".
 * Pure: no database, no imports.
 */

export const ANY = "*";

const sum = (values) => values.reduce((a, n) => a + (Number(n) || 0), 0);

export function isTracked(product) {
  return Array.isArray(product?.colorways) && product.colorways.some((w) => w && w.stock);
}

/** Total on hand across every colourway, for a tracked piece. */
function totalOf(colorways) {
  return colorways.reduce((acc, w) => acc + sum(Object.values(w.stock ?? {})), 0);
}

/** Units on the shelf for one variant, or the whole piece when `colorId` is "*". */
export function onHandOf(product, colorId = ANY, size = ANY) {
  if (colorId === ANY) return isTracked(product) ? totalOf(product.colorways) : Number(product.stock) || 0;
  const way = (product.colorways ?? []).find((w) => w.colorId === colorId);
  return Number(way?.stock?.[size]) || 0;
}

/** `stock` recomputed from the colourways for a tracked piece, so the total can never drift from its cells. */
export function withTotal(product) {
  return isTracked(product) ? { ...product, stock: totalOf(product.colorways) } : product;
}

/**
 * The piece with one variant's on hand changed by `delta`, never below zero.
 * An untracked piece changes its one number whatever variant is asked for.
 * Returns `{ product, onHandAfter }`.
 */
export function withOnHand(product, colorId, size, delta) {
  if (!isTracked(product) || colorId === ANY) {
    const onHandAfter = Math.max(0, (Number(product.stock) || 0) + delta);
    return { product: { ...product, stock: onHandAfter }, onHandAfter };
  }
  let onHandAfter = 0;
  let found = false;
  const colorways = product.colorways.map((w) => {
    if (w.colorId !== colorId) return w;
    found = true;
    onHandAfter = Math.max(0, (Number(w.stock?.[size]) || 0) + delta);
    return { ...w, stock: { ...(w.stock ?? {}), [size]: onHandAfter } };
  });
  if (!found) return { product, onHandAfter: null };
  return { product: { ...product, colorways, stock: totalOf(colorways) }, onHandAfter };
}

/**
 * History rows for what a product save changed, so the history is complete
 * whether stock moved through Inventory or the product form. `before` is null
 * for a new piece, whose stock is its opening count.
 */
export function stockDiff(before, after) {
  const note = before ? "Edited in the product form" : "Opening stock";
  const reason = before ? "adjusted" : "counted";
  const row = (colorId, size, delta, onHandAfter, extra = {}) => ({
    productId: after.id, colorId, size, delta, onHandAfter, reason, note, ...extra,
  });

  if (!isTracked(after)) {
    const delta = onHandOf(after) - (before ? onHandOf(before) : 0);
    return delta ? [row(ANY, ANY, delta, onHandOf(after))] : [];
  }

  // Counted as one number before, per colour and size now: one row for the
  // difference rather than one per cell it was spread across.
  if (before && !isTracked(before)) {
    const delta = onHandOf(after) - onHandOf(before);
    return delta ? [row(ANY, ANY, delta, onHandOf(after), { reason: "counted", note: "Split across colours and sizes" })] : [];
  }

  const cells = new Set();
  for (const p of [before, after].filter(Boolean)) {
    for (const w of p.colorways ?? []) for (const size of Object.keys(w.stock ?? {})) cells.add(`${w.colorId}|${size}`);
  }
  return [...cells].flatMap((cell) => {
    const [colorId, size] = cell.split("|");
    const now = onHandOf(after, colorId, size);
    const delta = now - (before ? onHandOf(before, colorId, size) : 0);
    return delta ? [row(colorId, size, delta, now)] : [];
  });
}
