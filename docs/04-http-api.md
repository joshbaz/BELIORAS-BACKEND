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
| `UNAUTHORIZED` | 401 | missing/expired/invalid token, wrong credentials |
| `FORBIDDEN` | 403 | reserved — role/capability guards (see [05](05-auth.md)) |
| `NOT_FOUND` | 404 | no route, missing resource (unified message, no path leakage) |
| `CONFLICT` | 409 | unique constraint (duplicate email) |
| `UNPROCESSABLE` | 422 | reserved — semantic validation (e.g. an invalid order state move) |
| `RATE_LIMITED` | 429 | exceeded a rate limit (see below) |
| `INTERNAL_ERROR` | 500 | everything else; the real error is logged, never shown |

This table intentionally matches the client's `src/api/error.js` `CODES` map
and its `UNPROCESSABLE`/`FORBIDDEN` semantics so `code` stays branchable.

## Rate limiting

Applied with `express-rate-limit` (`src/middlewares/rateLimit.js`), behind the
already-set `trust proxy`. Disabled with `RATE_LIMIT_ENABLED=false`.

| Limiter | Scope | Limit |
| --- | --- | --- |
| `createGlobalLimiter` | every request (`app.js`) | 300 / 15 min / IP |
| `createAuthLimiter` | `POST /auth/register`, `/auth/login` | 10 / 15 min / IP |
| `createRefreshLimiter` | `POST /auth/refresh` | 20 / 15 min / IP |

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
| `GET` | `/health` | — | Liveness + DB ping |
| `POST` | `/auth/register` | — | `{ realm, name?, email, password }` |
| `POST` | `/auth/login` | — | `{ realm, email, password }` |
| `POST` | `/auth/refresh` | cookie | `X-Auth-Realm` header; rotates the refresh cookie |
| `POST` | `/auth/logout` | cookie | clears this session's refresh token |
| `POST` | `/auth/logout-all` | cookie | revokes every session (`tokenVersion++`) |
| `GET` | `/auth/me` | Bearer | current user |
| `PATCH` | `/auth/me/preferences` | Bearer | `{ preferences: { … } }` |

Anything else → 404. Every rule a browser could bypass is enforced here again
([07](07-client-contract.md) notes which client-side docs say so).