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
 * The stock a form save should leave, given what the form loaded (`base`),
 * what it is sending (`next`) and what is on the shelf now (`current`).
 *
 * Only cells the editor actually changed move, and they move by the editor's
 * difference, applied to today's count: open the form at Ebony M = 3, type 5,
 * and if an order shipped one in the meantime the save leaves 4 (2 + 2) rather
 * than 5. Cells the editor left alone keep whatever is on the shelf now, so a
 * delivery received while the form was open is not undone by saving it.
 *
 * `base`: `{ stock?: n, colorways?: { [colorId]: { [size]: n } } }`. A cell the
 * form did not load (a colour or size just added) takes the form's number.
 */
export function mergeStock(current, next, base) {
  const apply = (loaded, sent, now) => {
    if (loaded === undefined) return sent; // a cell the form just added
    if (sent === loaded) return now; // left alone: keep what is on the shelf now
    return Math.max(0, now + (sent - loaded)); // edited: apply the editor's difference
  };

  if (!isTracked(next)) {
    // Counted as one number on both sides: merge that number.
    if (isTracked(current) || next.stock === undefined) return next;
    return { ...next, stock: apply(base?.stock, Number(next.stock) || 0, Number(current.stock) || 0) };
  }
  // Switching from one number to a per-size grid is a recount: the grid stands.
  if (!isTracked(current)) return next;

  const colorways = next.colorways.map((w) => {
    if (!w.stock) return w;
    const loaded = base?.colorways?.[w.colorId] ?? {};
    const stock = Object.fromEntries(
      Object.entries(w.stock).map(([size, sent]) => [size, apply(loaded[size], Number(sent) || 0, onHandOf(current, w.colorId, size))]),
    );
    return { ...w, stock };
  });
  return withTotal({ ...next, colorways });
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
