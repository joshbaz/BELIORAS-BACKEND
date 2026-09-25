# 00 — Code Conventions

Binding rules for every file in this server. The client runs the same rules
with the same spirit ([client `00-code-conventions.md`](../client/docs/00-code-conventions.md)).

## 1. Split rule

- **Max ~250 lines per file.** If a file exceeds it, split where the subject
  changes — a route file grows routes, a service grows operations, never one
  long file.
- **Domain logic lives in `src/features/<feature>/`** — version-independent
  services, guards, caches. `versions/*` folders hold transport only (routes,
  controllers, HTTP schemas, thin middleware), so a v2 mounts new HTTP without
  copying or hoisting business logic.
- A `1.` controller file imports `2.` feature services; services never import
  controllers or routes.

## 2. Comments

- Route files get one file-top comment naming the route group (`/* Auth
  Routes */`). No decorative banners, no `//` inline commentary on logic.
- Comment the *why* of a non-obvious decision, not the *what* — e.g. the
  reuse-detection rule in `auth.service.js`, or the replica-set note in
  `docker-compose.yml`.

## 3. Imports & exports

- ESM (`"type": "module"`). Relative imports inside `src`; extension move
  explicit (`.js`) — no barrel files that hide dependencies.
- `export const`, `export function`, `export default` for a single obvious
  entry (routers, `initSocket`). No default-export barrel of many symbols.
- Imports keep a blank-line group: built-in → third-party → internal.

## 4. Error handling

- Domain errors are `ApiError(message, status, { code?, details? })`
  (`src/core/ApiError.js`). Throw them from services; controllers stay thin.
- Express 5 forwards rejected promises from async handlers to the error
  middleware on its own — do **not** wrap handlers in try/catch just to
  forward. Only catch where you must transform or branch (e.g. JWT/Prisma
  error mapping).
- The error handler (`src/middlewares/errorHandler.js`) is the only place
  that turns thrown values into the `{ error }` envelope. New known-error
  types get mapped there, then documented in [04](04-http-api.md).

## 5. Secrets

- Nothing secret in code. All environment via `src/config/env.js` (zod
  validated, fails fast). Never log passwords, refresh tokens, or JWT
  payloads; log hashes/usernames at most.

## 6. Async & database

- Mongo + Prisma: every write is `await`ed; long operations belong in
  services. The Prisma client is a singleton (`src/db/prisma.js`) — import
  `prisma` from there, never `new PrismaClient()`.

## 7. File naming

- Straight `kebab-case.js` for modules. Prisma schema uses its own naming
  (`Realm` enum, `User` model, `@@map` collections).