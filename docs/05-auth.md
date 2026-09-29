# 05 — Auth

## Realms and boundaries

Two independent identity spaces, matching the client's `customer` / `staff`
realms (`client/src/api/tokens.js`). The `User` model carries
`realm` (`Realm` enum) per `@@unique([realm, email])` — a staff and a customer
account may share one address, and may be signed in simultaneously.

- Each realm owns a wire namespace: `/api/v1/storefront/auth/*` (customer) and
  `/api/v1/admin/auth/*` (staff). The realm is derived from the **path** via
  `setBoundary`, and guarded routes enforce it with `requireBoundary` — a staff
  token on a storefront route returns `403 FORBIDDEN`. No body field and no
  header carries the realm; clients pick the namespace they are addressing.
- A login never crosses realms: the query is scoped by realm, so a staff
  address at the customer door and a wrong password produce the **same 401**
  (`Invalid email or password.`) — no door oracle.
- Every token (access and refresh) carries the realm in its claims, and the
  boundary guard re-checks it.

## Staff registration is one-time bootstrap

`POST /admin/auth/register` exists only to create the **first** staff account.
The service counts staff users and refuses (`409 CONFLICT`) once one exists, so
a deployed server can never be used to mint extra staff — further staff are
provisioned through the dashboard.
`/storefront/auth/register` stays open for customers.

The account it mints is the shop's first **Administrator**
(`role: "super-admin"`), which is what makes the gate safe: there is exactly one
account this endpoint can ever create, and it is the one that must exist. In a
repeatable environment, `yarn seed:admin` (`scripts/seed-admin.js`) does the same
thing idempotently, so there is a way back in to a locked-out admin — and it
refuses outright if staff accounts exist that are not the one it was pointed at,
because that environment should be managed through the dashboard.

> **Not yet: creating further staff.** `POST /admin/auth/staff` (an authenticated,
> `super-admin`-gated create), the staff list and the role-change endpoint are
> still to come. Until they exist, a deployed server can hold exactly one staff
> account, seeded or bootstrapped.

## Roles

`User.role` is a dashboard role **id as a string** (`super-admin`, `staff`,
`finance`, `support`, `content`, `developer`, `customer`), mirroring the client's
catalogue `client/src/data/rolesSeed.js`. A string rather than a Prisma enum
because the client owns the catalogue and can add or edit roles without a server
deploy. `features/auth/roles.js` holds the two ids that mean something here.

**This is identity, not authority.** The role is stored, returned by
`publicUser`, and read by the dashboard to decide what to offer. The per-section
none/view/edit capability matrix is still client-side, so the browser's
`can`/`canEdit` checks remain an affordance rather than a control, exactly as
[07](07-client-contract.md) says. **No role rule is enforced yet** — the
staff-management endpoints that will gate on `super-admin` do not exist. When
the capability guards land, they read this same column, and a role change must
also `sessionCache.del` the affected user or the Redis-cached session keeps
serving the old role for `SESSION_CACHE_TTL`.


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
- Attributes: `HttpOnly`, `SameSite=Lax`, **`Path=/api/v1`** (covers both
  boundary namespaces — a browser only sends cookies to paths at or under their
  `Path`, so this is load-bearing for refresh), `Secure` in production,
  `Max-Age` from `REFRESH_TOKEN_TTL`.
- The cookie is **never readable by the client**. The realm is disambiguated by
  the path being hit and the cookie's own name; no `X-Auth-Realm` header exists
  anymore (`client/src/api/refresh.js`).

## Sessions

Each login/refresh stores a per-device `Session` (a rotated refresh token's
hash, plus the client's `requestMeta`). `GET /auth/sessions` lists the user's
devices; `DELETE /auth/sessions/:id` revokes one. `logout-all` clears them all
via `tokenVersion++`.

## Rotation + reuse detection

`POST /auth/refresh` does two things on every call (`/storefront` or `/admin`):

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
- `requireBoundary` (`versions/v1/middlewares/boundary.js`) runs after
  `authenticate` and compares `req.user.realm` to the boundary's injected
  `req.realm`, throwing `403 FORBIDDEN` on mismatch — the staff/customer wall.
- **Session cache**: `sessionCache` holds the checked session in **Redis** for
  `SESSION_CACHE_TTL` (default `60s`), so most requests need no database read.
  If Redis is down the cache degrades to database reads (a warning is logged,
  nothing crashes). Every session mutation (login, refresh, logout, logout-all,
  preferences) deletes the entry, so **revocation still applies immediately** —
  the TTL only delays seeing mutations that don't bump `tokenVersion`.
- Audit: sign-ins and other notable auth events write to `AuditLog`
  (`AuditAction`), tagged with `requestMeta` (IP + user-agent) so the client's
  activity dashboard has something real to read.

## Future reserved

- **Staff management** — `POST /admin/auth/staff` (create, `super-admin`-gated),
  `GET /admin/auth/staff` (list) and `PATCH /admin/auth/staff/:id` (role
  change), replacing the client Team page's mock calls. The admin sets the
  password directly for now; the invite flow (single-use token, the invited
  person chooses their own password, reusing the client's `/atelier/invite`
  page) is the intended replacement and reuses these same shapes.
- Capability guards per staff endpoint, reading `User.role` — see **Roles**
  above for the cache trap.
- Password reset, and an invited-user status map to the client's
  `welcome`/`password-reset`/`team-invitation` email flows
  (`client/docs/12-backend-integration.md`).
