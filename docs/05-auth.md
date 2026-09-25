# 05 — Auth

## Realms

Two independent identity spaces, matching the client's `customer` / `staff`
realms (`client/src/api/tokens.js`). The `User` model carries
`realm` (`Realm` enum) per `@@unique([realm, email])` — a staff and a customer
account may share one address, and may be signed in simultaneously.

- A login never crosses realms: the query is scoped by realm, so a staff
  address at the customer door and a wrong password produce the **same 401**
  (`Invalid email or password.`) — no door oracle.
- Every token (access and refresh) carries the realm in its claims.

## Tokens

| Token | Claims | Lifetime | Transport |
| --- | --- | --- | --- |
| Access | `sub` (user id), `realm`, `tv` (tokenVersion) | `ACCESS_TOKEN_TTL` (15m) | `Authorization: Bearer` |
| Refresh | `sub`, `realm`, `jti` | `REFRESH_TOKEN_TTL` (30d) | httpOnly cookie |

Secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — distinct, ≥ 32 chars.
Lifetimes are jsonwebtoken strings (`15m`, `30d`).

## Refresh cookie

- Name is realm-scoped: `belioras_refresh_customer` / `belioras_refresh_staff`,
  so one browser holds two sessions without collision.
- Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth` (sent only to
  auth routes), `Secure` in production, `Max-Age` from `REFRESH_TOKEN_TTL`.
- The cookie is **never readable by the client**; the client addresses its
  realm session with the `X-Auth-Realm` header it already sends
  (`client/src/api/refresh.js`).

## Rotation + reuse detection

`POST /auth/refresh` does two things on every call:

1. **Rotates**: if the presented refresh token matches the user's stored
   `refreshHash`, it issues a new token, stores its hash, and replaces the
   cookie.
2. **Detects reuse**: if `refreshHash` does not match, the token was either
   already rotated-away or stolen. Both cases are one response (401), and the
   mismatch **revokes everything**: `refreshHash → null` and
   `tokenVersion++`, which invalidates every outstanding access token.

This is what makes `logout-all` and the client's refresh dedupe
(`refreshSession`) safe: the client sends at most one refresh per realm at a
time, so a normal page load never trips the detector.

> **MongoDB gotcha on `refreshHash`.** `refreshHash` must be nullable and
> **non-unique**. Prisma's MongoDB provider treats every `null` as a document;
> a `@unique` field with many `null`s collides and `db push`/`create` starts
> returning duplicates as 409 `CONFLICT`. The rotation design needs exactly one
> stored hash per user, so the login/register flows deliberately leave it
> nullable instead. If this "duplicate email" behaviour ever reappears, re-check
> that no index on `refreshHash` survived a generator version bump.

## Guards

- `checkSession(token)` (`src/features/auth/guards.js`) is the single guard
  used by **both** HTTP `authenticate` and the socket handshake. It:
  - verifies the HS256 signature (expired/invalid → 401 via the error handler);
  - consults the session cache, else loads the user and requires `realm` +
    `tokenVersion` to match the token — a logout-all immediately disables old
    access tokens;
  - returns the caller's public user and refreshes the cache.
- `authenticate` (`versions/v1/middlewares/authenticate.js`) is a thin HTTP
  adapter: it extracts the `Bearer` token and delegates to `checkSession`,
  setting `req.user` for controllers.
- **Session cache**: `sessionCache` holds the checked session in memory for
  `SESSION_CACHE_TTL` (default `60s`), so most requests need no database read.
  Every session mutation (login, refresh, logout, logout-all, preferences)
  deletes the entry, so **revocation still applies immediately** — the TTL only
  delays seeing mutations that don't bump `tokenVersion`.
- The refresh endpoints re-derive the realm from `X-Auth-Realm`, never from
  the token itself, so a staff cookie can't mint a customer session
  ([07](07-client-contract.md)).

## Future reserved

- `FORBIDDEN` and role/capability guards — the client's dashboard role model
  (`utils/roles.js`) is the documented intent; enforce the same capabilities
  per staff endpoint when the roles exist server-side.
- Password reset, team invitations, and an invited-user status map to the
  client's `welcome`/`password-reset`/`team-invitation` email flows
  (`client/docs/12-backend-integration.md`).