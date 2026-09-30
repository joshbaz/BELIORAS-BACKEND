/* Slug Derivation */

const LIGATURES = {
  œ: "oe",
  æ: "ae",
  ø: "o",
  ß: "ss",
  đ: "d",
  ð: "d",
  þ: "th",
  ł: "l",
};

/**
 * A url-safe slug of a name.
 *
 * Byte-for-byte the same rules as the client's `productSlug.slugify`, and that
 * is the whole reason it is duplicated rather than shared: a size created
 * server-side has to come out with the id the client would have given it, or
 * moving a write to this server would silently change the id scheme. If the
 * client's rules ever change, this has to change with them — the two are one
 * contract with two homes.
 */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[œæøßđðþł]/g, (ch) => LIGATURES[ch] ?? ch)
    // Split accented letters into base + combining mark, then drop the marks.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
