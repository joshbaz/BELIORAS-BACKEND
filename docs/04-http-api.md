# 04 — HTTP API

## Versioning

All endpoints live under `/api/v1` (mounted in `src/app.js` from
`versions/v1`). The version lives in the URL, exactly as the client pins it
(`client/src/api/config.js`). A second version becomes `versions/v2` with its
own mount — nothing else changes.

## Success shape

- Plain response → `{ "data": <value|null> }`.
- Empty body → HTTP `204` with no JSON (logout-all).
- A paged collection later → `{ "data": [...], "meta": { ... } }`, read by the
  client's `http.list`.

`GET /api/v1/health` is an exception in spirit only — the escalator payload is
`data.status` (`ok`/`degraded`), HTTP `200`/`503`.

## Error shape

Every failure arrives as one shape from the error handler:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Please sign in to continue.", "requestId": "…" } }
```

- `details` appears only when there is something structural to say. The
  request-validator failure includes field errors keyed by field name:
  `"details": { "fieldErrors": { "email": "Enter a valid email address." } }`
- `requestId` is the `x-request-id` header echoed on the response.

| Code | HTTP | Source |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | zod validation |
| `UNAUTHORIZED` | 401 | missing/expired/invalid token, wrong credentials, spent refresh token |
| `FORBIDDEN` | 403 | boundary violation — staff token on a storefront or customer route (see [05](05-auth.md)) |
| `NOT_FOUND` | 404 | no route, missing resource (unified message, no path leakage) |
| `CONFLICT` | 409 | unique constraint (duplicate email) or staff already provisioned |
| `UNPROCESSABLE` | 422 | reserved — semantic validation (e.g. an invalid order state move) |
| `RATE_LIMITED` | 429 | exceeded a rate limit (see below) |
| `INTERNAL_ERROR` | 500 | everything else; the real error is logged, never shown |

This table intentionally matches the client's `src/api/error.js` `CODES` map
and its `UNPROCESSABLE`/`FORBIDDEN` semantics so `code` stays branchable.

## Boundaries

The API is split into two namespaces per realm — the **storefront** (customers)
and the **admin** (staff). Each is a router that injects its realm via
`setBoundary`; guarded routes then enforce it with `requireBoundary`
(`src/versions/v1/middlewares/boundary.js`). A staff token on a
`/storefront/*` route (or vice versa) is a `403 FORBIDDEN`.

```
/api/v1/storefront/auth/*   → customer realm
/api/v1/admin/auth/*        → staff realm
```

The realm is derived from the **path**, never from the body or a header — the
client-facing `realm` field and the `X-Auth-Realm` header are gone.

## Rate limiting

Applied with `express-rate-limit` (`src/middlewares/rateLimit.js`), behind the
already-set `trust proxy`. Disabled with `RATE_LIMIT_ENABLED=false`.

| Limiter | Scope | Limit |
| --- | --- | --- |
| `createGlobalLimiter` | every request (`app.js`); **exempts `GET /api/v1/health`** so monitoring can poll freely | 300 / 15 min / IP |
| `createAuthLimiter` | `POST /auth/register`, `/auth/login` (both boundaries) | 10 / 15 min / IP |
| `createRefreshLimiter` | `POST /auth/refresh` (both boundaries) | 20 / 15 min / IP |

A 429 returns the same envelope as everything else:
`{ "error": { "code": "RATE_LIMITED", "message": "...", "requestId": "…" } }`.
Because tests hammer the auth endpoints, the test suite builds its app with
limiters off and exercises one limiter in isolation.

## Input validation

- Request bodies are validated against zod schemas before controllers run
  (see `versions/v1/schemas` and the `validate` middleware in
  `src/middlewares/validate.js`).
- The `Content-Type: application/json` limit is `1mb`.

## Endpoints in this version

| Method | Path | Auth | Body/Notes |
| --- | --- | --- | --- |
| `GET` | `/health` | — | Liveness + DB + Redis ping (exempt from the global limiter) |
| `POST` | `/storefront/auth/register` | — | `{ name?, email, password }` — open to customers |
| `POST` | `/admin/auth/register` | — | one-time staff bootstrap: succeeds **only until the first staff user exists**, then `409` (staff are provisioned by invite/seed) |
| `POST` | `/storefront/auth/login` · `/admin/auth/login` | — | `{ email, password }` — uniform `401` for wrong password, wrong realm, or unknown address |
| `POST` | `/storefront/auth/refresh` · `/admin/auth/refresh` | cookie | rotates that realm's refresh cookie; reintroduced token → `401` + full revoke |
| `POST` | `/storefront/auth/logout` · `/admin/auth/logout` | cookie | clears this session's refresh token |
| `POST` | `/storefront/auth/logout-all` · `/admin/auth/logout-all` | cookie | revokes every session (`tokenVersion++`) → `204` |
| `GET` | `/storefront/auth/me` · `/admin/auth/me` | Bearer | current user (boundary-enforced: staff/customer tokens never cross) |
| `PATCH` | `/storefront/auth/me/preferences` · `/admin/auth/me/preferences` | Bearer | `{ preferences: { … } }` |
| `GET` | `/storefront/auth/sessions` · `/admin/auth/sessions` | Bearer | this user's device sessions (used for "manage devices") |
| `DELETE` | `/storefront/auth/sessions/:id` · `/admin/auth/sessions/:id` | Bearer | revoke one session |

Anything else → 404. Every rule a browser could bypass is enforced here again
([07](07-client-contract.md) notes which client-side docs say so).