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
already-set `trust proxy`.

**Production only.** Outside production the limiters are off by default, because
in development every request arrives from `127.0.0.1` and one shared bucket
means a reload loop or a second machine locks out the whole team with no way to
tell that from an attack. `RATE_LIMIT_ENABLED=false` still disables them in
production; the `enabled` option on each limiter overrides both, which is how
the tests exercise them.

| Limiter | Scope | Limit |
| --- | --- | --- |
| `createGlobalLimiter` | every request (`app.js`); **exempts `GET /api/v1/health`** so monitoring can poll freely | 300 / 15 min / IP |
| `createAuthLimiter` | `POST /auth/register`, `/auth/login` (both boundaries) | 10 / 15 min / **account + IP**, plus 60 / 15 min / IP |
| `createRefreshLimiter` | `POST /auth/refresh` (both boundaries) | 60 / 15 min / IP |

`createAuthLimiter` is two counters. The account one is keyed by account and IP
together, so a lockout is spent by one account from one address and no other —
a colleague's mistyped password behind the same office connection cannot lock
out the person who typed theirs correctly. The IP counter exists because a
password spray walks *many* accounts from one source, which per-account buckets
never notice; it is loose on purpose. A request with no parseable `email` falls
back to the address, so the limiter cannot be walked around by omitting the
field.

`createRefreshLimiter` is keyed by IP because it runs before `authenticate` —
the refresh token is an httpOnly cookie, so there is no account to read. It is
loose because a refresh is not a guessing surface: a valid cookie cannot be
brute-forced, and reuse of a spent one is caught by the token-reuse check.

A 429 returns the same envelope as everything else:
`{ "error": { "code": "RATE_LIMITED", "message": "...", "requestId": "…" } }`.
The client treats a 429 as **"not yet", not "signed out"** — it keeps the
session and offers a retry. Only a 401 or 403 ends a session.

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
| `GET` | `/storefront/auth/me` · `/admin/auth/me` | Bearer | current user, including its dashboard `role` (boundary-enforced: staff/customer tokens never cross) |
| `PATCH` | `/storefront/auth/me/preferences` · `/admin/auth/me/preferences` | Bearer | `{ preferences: { … } }` |
| `GET` | `/storefront/auth/sessions` · `/admin/auth/sessions` | Bearer | this user's device sessions (used for "manage devices") |
| `DELETE` | `/storefront/auth/sessions/:id` · `/admin/auth/sessions/:id` | Bearer | revoke one session |
| `GET` | `/storefront/size-guides` | — | all three guides, keyed `garment`/`footwear`/`hair`; the one resource a shopper reads with no account, and the reason it is mounted from its own file |
| `GET` | `/admin/size-guides` · `/admin/size-guides/:type` | Bearer | same documents to staff; `:type` unknown → `404` |
| `PUT` | `/admin/size-guides/:type` | Bearer + role | replaces one guide **whole**. Body is that guide alone, validated against the schema for `:type` — a body shaped like a different guide is a `400`. All-or-nothing: a rejected save leaves the stored guide untouched |
| `POST` | `/admin/size-guides/reset` | Bearer + role | all three guides back to the shipped versions |

The two staff write routes take `content`, `staff` or `super-admin` — the roles
the dashboard grants "edit" on Sizes & Guides. This is a list at the call site,
not a copy of the client's capability matrix; see [07](07-client-contract.md).

Anything else → 404. Every rule a browser could bypass is enforced here again
([07](07-client-contract.md) notes which client-side docs say so).

## The public user

`register`, `login`, `refresh` and `me` all return the same user object, from
`publicUser` (`src/features/auth/guards.js`): every field except the password
hash and `tokenVersion`.

```jsonc
{
  "id": "6ab953c2eaf2bb7154e076d4",
  "realm": "staff",              // or "customer"
  "email": "admin@belioras.com",
  "name": "Belioras Administrator",
  "role": "super-admin",         // dashboard role id, see [05](05-auth.md)
  "preferences": null,
  "createdAt": "2026-09-27T17:34:58.281Z",
  "updatedAt": "2026-09-27T17:34:58.281Z"
}
```

`role` is a **string role id, not an enforced capability** — the per-section
none/view/edit matrix still lives in the client, and no server-side role guard
exists yet (see [05](05-auth.md)). `tokenVersion` is deliberately withheld: it
is the internal revocation counter and belongs on no wire.
