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
| `GET` | `/storefront/taxonomy/sizes` | — | the size list, in display order. Public for the same reason the guides are: a shopper filtering a category page has no account, and the list is what `?size=eu38,m` resolves against |
| `GET` | `/admin/taxonomy/sizes` · `/admin/taxonomy/sizes/:id` | Bearer | same list to staff; `:id` unknown → `404` |
| `POST` | `/admin/taxonomy/sizes` | Bearer + role | `{ name, id? }`. `201`. `id` optional and, when given, must be free — a taken or spent one is a `409`, not a silently different id. Without one, a slug of the name is derived and suffixed if needed |
| `PATCH` | `/admin/taxonomy/sizes/:id` | Bearer + role | `{ name }` **only**. The body is `strict()`: an `id` or a `position` in it is a `400` rather than a `200` that quietly changed just the name |
| `DELETE` | `/admin/taxonomy/sizes/:id` | Bearer + role | removes one and **spends its id** — see below |
| `POST` | `/admin/taxonomy/sizes/reset` | Bearer + role | back to the shipped twelve; every id added since is spent |
| `GET` | `/storefront/taxonomy/categories` | — | every category with its `sizes` and `subcategories` (each with its `types`), in display order. Public: the shop filters, menu and breadcrumbs read it without an account |
| `GET` | `/admin/taxonomy/categories` · `/admin/taxonomy/categories/:id` | Bearer | same list to staff; `:id` unknown → `404` |
| `POST` | `/admin/taxonomy/categories` | Bearer + role | `{ name, sizes[], subcategories[{id?,name,types[{id?,name}]}] }` — types live only inside subcategories; a top-level `types` is a `400`. `201`. The category id is derived from the name and suffixed past live **and spent** ids; it cannot be supplied. Duplicate name → `409` |
| `PATCH` | `/admin/taxonomy/categories/:id` | Bearer + role | same body, `strict()` — an `id` or `position` is a `400`. Subcategories and their types keep their id when the body echoes a known one; anything else gets a fresh id from its name. Array order is stored as given |
| `PUT` | `/admin/taxonomy/categories/order` | Bearer + role | `{ ids }` — every category id in the new order. Anything but exactly the current set → `409` |
| `DELETE` | `/admin/taxonomy/categories/:id` | Bearer + role | removes one and spends its id (`FreedId` kind `category`) |
| `POST` | `/admin/taxonomy/categories/reset` | Bearer + role | back to the shipped three; every id added since is spent |
| `GET` | `/storefront/products` · `/storefront/products/:idOrSlug` | — | active pieces only, **never `costPrice`**; a draft or deleted piece is a `404` |
| `GET` | `/admin/products` · `/admin/products/:id` | Bearer | every live piece, drafts included, with cost price |
| `POST` | `/admin/products` | Bearer + role (content, staff, super-admin) | `201`. `strict()` body. Id is `p<n>` past every id ever issued; slug unique across every row. Refused (`422`) if its category, a colour, a size or a `subcat:` tag does not exist. `stock` is recomputed from the colourways; opening stock is written to the history |
| `PATCH` | `/admin/products/:id` | Bearer + role | any subset of the same fields. Slug moves only when the name does. Stock changes from the form are written to the history in the same transaction |
| `DELETE` | `/admin/products/:id` | Bearer + role | soft: the piece disappears everywhere, its id and slug stay reserved |
| `POST` | `/admin/products/:id/restore` | Bearer + role | the dashboard's Undo |
| `POST` | `/admin/inventory/adjust` | Bearer + role (staff, super-admin) | `{ productId, colorId, size, mode: add\|remove\|set, quantity, reason, note }`. Removing more than is on hand → `409`. Answers `{ movements, products }` |
| `POST` | `/admin/inventory/receive` | Bearer + role (staff, super-admin) | `{ variants[], quantity, reason, note }` — the same number into each |
| `POST` | `/admin/inventory/order-movements` | Bearer + role (support, staff, super-admin) | `{ orderId, reason: sold\|returned, lines[] }`. Only for orders, so support can ship without hand-editing stock. A second `sold` for the same order → `409` |
| `GET` | `/admin/inventory/movements?productId&colorId&size` | Bearer | one variant's history, newest first |
| `GET` · `PUT` | `/admin/inventory/settings` | Bearer (+ role staff, super-admin to write) | `{ lowStockThreshold }`, 0–999, default 3 |
| `POST` | `/admin/uploads` | Bearer + role (content, staff, super-admin) | multipart `file` (+ `folder`: products · menu · models). Type decided from the bytes: JPEG/PNG/WebP/AVIF ≤ 10 MB, MP4/MOV/WebM ≤ 100 MB. `201 { url, kind, mime, size }`. Stored on ImageKit when `IMAGEKIT_PRIVATE_KEY` + `IMAGEKIT_URL_ENDPOINT` are set, else in `UPLOAD_DIR` served at `/api/uploads` (development) |
| `GET` | `/storefront/navigation` | — | `{ items, version }` — the mega menu tree. Public: every page's header and footer. Created from the shipped menu on first read |
| `GET` | `/admin/navigation` | Bearer | same, to staff |
| `PUT` | `/admin/navigation` | Bearer + role | `{ items, version }` — the whole tree, plus the version it was edited from. A stale version → `409` (someone else saved first). Checks names, non-empty columns, unique ids and addresses, and reserved addresses; a problem is a `400` whose message says which. Whether targets still exist is the dashboard's check (it needs the catalogue) |
| `POST` | `/admin/navigation/reset` | Bearer + role | back to the shipped menu; bumps the version so an open editor cannot save over the reset |
| `GET` | `/storefront/taxonomy/colors` | — | every colour (`id`, `name`, `hex`, `family`), A–Z. Public: every product's swatches and the colour filter resolve through it |
| `GET` | `/admin/taxonomy/colors` · `/admin/taxonomy/colors/:id` | Bearer | same list to staff; `:id` unknown → `404` |
| `POST` | `/admin/taxonomy/colors` | Bearer + role | `{ name, hex, family }`, `strict()`. `201`. Id derived from the name past live and spent ids; duplicate name → `409` |
| `PATCH` | `/admin/taxonomy/colors/:id` | Bearer + role | same body, `strict()` — an `id` is a `400` |
| `DELETE` | `/admin/taxonomy/colors/:id` | Bearer + role | removes one and spends its id (`FreedId` kind `color`) |
| `POST` | `/admin/taxonomy/colors/reset` | Bearer + role | back to the shipped list; every id added since is spent |

### Why the size list is shaped this way

The list and the guides are separate resources, and they are allowed to
disagree. A guide is the measurement table that explains what a size means; this
is the list of sizes that exist. Merging them would mean saving a size's name
rewrote a guide. They currently *do* disagree — the garment guide has an `XXL`
row with no size in the list, and the list has EU sizes and One Size the garment
guide has no row for. That is a content question, not a modelling one, and
nothing in either resource tries to paper over it.

**The id is permanent.** It is a key in a product's `colorways[].stock`, a
segment of a bookmarked `?size=eu38,m`, and the thing `sizeChartKind.js`
pattern-matches to decide which guide a product opens. So a rename is a `PATCH`
by id and the body cannot carry an id — re-pointing one would re-point every
stock row and every saved URL holding it, which is not something a rename
should be able to do by accident.

**A deleted id is never reissued** (`FreedId`). Deleting a size does not
un-reference it: whatever carried it still does, in the browser's catalogue. A
deleted id handed to the next size would silently re-point all of it at a
different size, with stock counts to match, and nothing in the write path would
know. The unique index on `(kind, ref)` is what makes that safe under
concurrency.

**Deletion is guarded here.** A size a category offers or a live product
carries cannot be deleted (`409`, naming who uses it). The spent id is still
recorded, as the second line of defence.

**Categories and colours follow the same rules.** A colour id is what a
product's `colorways[].colorId` stores, so it is just as permanent. A category id is every product's
`collectionId`, the `/dresses` URL and a filter token; a subcategory type is a
product's `subcat:<sub>:<type>` tag (there are no flat category types). So ids never change,
deleted category ids are spent, and the in-use guards are the server's: a
category holding live products, a colour on a live product, and a subcategory
type still tagged on one are each a `409`. Only "a Mega Menu link points at it"
is checked by the dashboard alone, before it asks.

The staff write route groups take `content`, `staff` or `super-admin` — the
roles the dashboard grants "edit" on Sizes & Guides. This is a list at the call
site, not a copy of the client's capability matrix; see
[07](07-client-contract.md).

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
