/* Socket Room Naming Convention */

/**
 * Centralised room name definitions. All socket handlers MUST use these
 * helpers instead of writing room strings inline. This prevents typos and
 * makes refactoring trivial.
 *
 * Convention:
 *   Broadcast rooms  → noun (e.g. "staff", "public")
 *   Entity rooms     → noun:id (e.g. "user:abc123", "order:xyz")
 */

/** All authenticated staff users — for admin broadcast events. */
export const ROOM_STAFF = "realm:staff";

/** All anonymous + authenticated customer users — for public broadcast events. */
export const ROOM_PUBLIC = "realm:public";

/** Private room for a specific user (all their connected sockets). */
export const roomUser = (userId) => `user:${userId}`;

/** All sockets tracking a specific order (staff + customer owner). */
export const roomOrder = (orderId) => `order:${orderId}`;

/** All sockets in a given realm — useful for realm-wide broadcasts. */
export const roomRealm = (realm) => `realm:${realm}`;
