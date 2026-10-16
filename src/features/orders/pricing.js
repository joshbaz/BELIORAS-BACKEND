/* Order Pricing */

/**
 * Checkout arithmetic, the server's copy of the client's `utils/checkout.js`.
 *
 * The browser shows these numbers while the shopper fills the form; this is
 * what the order is actually charged. Kept rule for rule the same, so the two
 * agree whenever nothing changed in between — and when something did (a price,
 * a coupon), checkout refuses rather than charging a total the shopper never
 * saw. VAT is inclusive: extracted from the total, never added on top.
 */

export const SHIPPING_COUNTRIES = {
  de: ["Germany"],
  eu: [
    "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark", "Estonia",
    "Finland", "France", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg",
    "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
  ],
  intl: ["United Kingdom", "Switzerland", "Norway", "United States", "Canada", "Australia", "New Zealand"],
};

const ALIASES = { czechia: "czech republic", uk: "united kingdom", "great britain": "united kingdom", usa: "united states", "united states of america": "united states" };
const ZONE_BY_COUNTRY = new Map(
  Object.entries(SHIPPING_COUNTRIES).flatMap(([zone, names]) => names.map((n) => [n.toLowerCase(), zone])),
);

export function zoneIdFor(country) {
  const name = String(country ?? "").trim().toLowerCase();
  return ZONE_BY_COUNTRY.get(ALIASES[name] ?? name) ?? null;
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** `lines`: `[{ price, quantity }]`. `coupon`: a redeemable coupon or null. */
export function computeTotals({ lines, country, coupon = null, settings }) {
  const zone = (settings?.shipping?.zones ?? []).find((z) => z.id === zoneIdFor(country)) ?? null;
  const shippable = Boolean(zone);
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  let discount = 0;
  if (coupon?.type === "percent") discount = (subtotal * coupon.value) / 100;
  else if (coupon?.type === "fixed") discount = coupon.value;
  if (coupon?.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.min(discount, subtotal);

  const goods = subtotal - discount;
  const free =
    shippable &&
    ((zone.flat ?? 0) === 0 || (zone.freeThreshold != null && goods >= zone.freeThreshold) || coupon?.type === "free_shipping");
  const shipping = !shippable || free ? 0 : (zone.flat ?? 0);
  const total = goods + shipping;
  const rate = settings?.tax?.rate ?? 0;
  const tax = rate > 0 ? total - total / (1 + rate) : 0;

  return {
    shippable,
    subtotal: round2(subtotal),
    discount: round2(discount),
    shipping: round2(shipping),
    tax: round2(tax),
    total: round2(total),
  };
}
