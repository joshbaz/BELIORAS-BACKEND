# 07 — Client Contract

The Belioras client already speaks the exact contract this server implements.
This file is the binding map between the two, so wiring a service never means
"guess the endpoint" — it means "read the row".

## Base URL and version

- Client builds `${base}/api/${version}` with `apiRoot`
  (`client/src/api/config.js`): default `""` → **same-origin `/api/v1`**.
- Locally, Vite proxies `/api` → `http://localhost:5002`
  (`client/vite.config.js`), so the client never hardcodes the API origin and
  the refresh cookie stays first-party (no preflight, Safari-safe).
- Production (Netlify) proxies `/api` the same way.

## Response envelope (`client/src/api/client.js`)

- Success → `{ data }`; paged later → `{ data: [...], meta }`; `204` → `{ data: null }`.
- `http.list` expects `data` to be the array and reads page counts from `meta`.
- Current auth endpoints return `{ data: { user, accessToken } }` (register,
  login) and `{ data: { accessToken } }`-shaped (refresh). The client's
  refresh already reads `body.data.accessToken` (`client/src/api/refresh.js`).

## Error envelope (`client/src/api/error.js`)

The client's `ApiError` mirrors the server's exact shape:

| Field | Meaning |
| --- | --- |
| `code` | `BAD_REQUEST` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `UNPROCESSABLE` 422 · `RATE_LIMITED` 429 · `INTERNAL_ERROR` 500 |
| `message` | Human message; the server sends English, the client translates for display |
| `details.fieldErrors` | Zod field errors, keyed by field name — surfaced as `err.fieldErrors` |
| `requestId` | Correlation id for support requests |

## Realm polarity (the rule that must never break)

The client keeps **two separate sessions** in one browser (`customer`,
`staff`), each with its own token slot and refresh cookie
(`client/src/api/tokens.js`).

- The Bearer access token carries the realm; the server's `authenticate`
  refuses a realm mismatch.
- Refresh reads the realm from the **`X-Auth-Realm` header**, not the token, so
  `belioras_refresh_staff` can never mint a customer session
  (`client/src/api/refresh.js` sends this header on every refresh).
- Wrong-realm and wrong-password logins answer a uniform 401
  (`client/src/services/auth/authSession.js` documents the same rule client-side).

## Auth endpoints (`client/src/api/routes.js`)

| Client route constant | Path | Server note |
| --- | --- | --- |
| `routes.health` | `GET /api/v1/health` | Returns `{ data: { status, db, uptime, timestamp } }` |
| `routes.auth.register` | `POST /auth/register` | 201; conflict → 409 |
| `routes.auth.login` | `POST /auth/login` | 200; invalid → uniform 401 |
| `routes.auth.refresh` | `POST /auth/refresh` | needs cookie + `X-Auth-Realm`; rotation + reuse detection |
| `routes.auth.logoutAll` | `POST /auth/logout-all` | clears realm cookie; `tokenVersion++`; 204 |
| `routes.auth.me` | `GET /auth/me` | Bearer-guarded |
| `routes.auth.preferences` | `PATCH /auth/me/preferences` | Bearer-guarded; returns updated user |

## Remaining namespaces

`API_NAMESPACES` reserves the rest — `catalog`, `content`, `inventory`,
`pricing`, `cart`, `checkout`, `orders`, `payments`, `customers`, `behavior`,
`reviews`, `media`, `notifications`, `search`, `analytics` — as `v1`
namespaces this server still has to mount, one module at a time, in the same
`versions/v1` pattern as `auth`. Until a route mounts, the client keeps its
mock (`VITE_API_MOCKS=true`, and services opt in one at a time).

## Flows the client cares about (from `client/docs/12-backend-integration.md`)

- **Payment is confirmed only by webhooks** — nothing on the dashboard marks an
  order paid, and `updateOrderStatus` refuses to. A future `POST /payments/webhook`
  (idempotent) + `#webhooks` mount replaces the mock `confirmPayment`.
- **Money rules** (VAT-inclusive totals, refund cap = paid − refunded, invoice
  numbering) are server-side final; `client/docs/12-*` documents them.
- **Every browser check is a user-experience affordance, not a security
  control** — permissions, ownership, stock, coupon limits and refund caps
  must be re-enforced in the API. The `authenticate` guard and the 401/403
  semantics here are the start; the dashboard capability model
  (`utils/roles.js`) maps onto the reserved `FORBIDDEN`/roles work in
  [05](05-auth.md).