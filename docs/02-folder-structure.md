# 02 — Folder Structure

```
server/
├── package.json            # yarn scripts: dev, start, db:push, db:generate, db:studio, test, lint
├── .env.example            # Copy to .env; never commit .env
├── .gitignore
├── docker-compose.yml      # Local MongoDB (replica set) + Redis
├── eslint.config.js
├── prisma/
│   └── schema.prisma       # Realm enum + User, Session, AuditLog
├── docs/                   # This documentation series
├── test/                   # node:test suites (auth, health, rateLimit) against belioras_test
└── src/
    ├── index.js            # Entry: connects DB + Redis, builds app, attaches sockets, listens
    ├── app.js              # Express assembly: helmet/cors/json/cookies/requestId/httpLogger/limiters, mounts /api/v1
    ├── config/
    │   ├── env.js          # Zod-validated environment, fails fast on missing values
    │   └── index.js        # config object (http host, api path, cookie names/path)
    ├── core/
    │   ├── ApiError.js     # Domain error + code map
    │   └── logger.js       # pino instance shared by every module (no console.*)
    ├── db/
    │   ├── prisma.js       # PrismaClient singleton
    │   └── redis.js        # ioredis singleton (lazyConnect; errors degrade to DB reads)
    ├── features/
    │   └── auth/           # Version-independent domain: the answer to v2 layering
    │       ├── auth.service.js  # register (staff bootstrap gate)/login/refresh/logout/logoutAll/preferences/listSessions/revokeSession + audit
    │       ├── guards.js        # checkSession(token): verify + cache + tokenVersion re-check; publicUser
    │       ├── sessionCache.js  # Redis-backed cache (SESSION_CACHE_TTL), invalidated on every mutation
    │       ├── tokens.js        # JWT sign/verify/hash + refresh-cookie helpers
    │       └── index.js         # barrel for the feature's public surface
    ├── middlewares/        # Cross-cutting, app-level
    │   ├── requestId.js    # x-request-id per request (echoed in errors)
    │   ├── rateLimit.js    # createGlobalLimiter (skips /health) / createAuthLimiter / createRefreshLimiter -> 429 envelope
    │   ├── notFound.js     # 404 → ApiError
    │   ├── errorHandler.js # Every thrown value → { error } envelope
    │   └── validate.js     # Generic zod request-slice validator
    ├── versions/
    │   └── v1/             # Transport only: routes, controllers, HTTP schemas
    │       ├── index.js    # Mounts /api/v1 → health + storefront + admin boundaries
    │       ├── routes/     # health.routes.js, auth.routes.js (shared session router with limiters)
    │       ├── controllers/ # Thin: parse → call feature service → respond
    │       ├── middlewares/ # authenticate.js (over features/auth/guards), boundary.js (setBoundary/requireBoundary)
    │       ├── schemas/    # auth.schema.js (zod request shapes)
    │       ├── storefront/ # boundary router: /storefront/auth (+ customer register)
    │       └── admin/      # boundary router: /admin/auth (no public register — staff are one-time bootstrap)
    └── sockets/
        ├── index.js        # initSocket(server): Socket.IO + optional auth via features/auth/guards
        ├── rooms.js        # room naming per realm and entity (staff/public/order/realm)
        └── handlers/       # connection.js (realm rooms), ping.js (sample event)
```

## Rules

- **`versions/v1` owns the HTTP surface.** Route → controller → feature service is
  the only legal call direction; feature services never import express.
- **Domain logic is version-independent.** Add a second version as a new
  `versions/v2/` transport folder over the same `features/` — no services get
  copied. Shared infra stays in `middlewares/`, `core/`, `config/`, `db/`,
  `sockets/`.
- **`sockets/` and `middlewares/` are version-independent.** If v2 needs a
  guard v1 doesn't, the guard drops into `versions/v2/middlewares/`.
- **`core/` holds infrastructure errors only** — nothing that imports express
  or prisma.
- **`features/` is where domain services, guards, and caches live.**

Where the client is concerned: [07](07-client-contract.md) maps every
client-visible path to its server home.