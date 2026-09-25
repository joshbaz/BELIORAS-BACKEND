# 02 — Folder Structure

```
server/
├── package.json            # yarn scripts: dev, start, db:push, db:generate, db:studio, test, lint
├── .env.example            # Copy to .env; never commit .env
├── .gitignore
├── docker-compose.yml      # Local MongoDB as a single-node replica set
├── eslint.config.js
├── prisma/
│   └── schema.prisma       # Realm enum + User model
├── docs/                   # This documentation series
├── test/                   # node:test suites (auth, health, rateLimit)
└── src/
    ├── index.js            # Entry: connects DB, builds app, attaches sockets, listens
    ├── app.js              # Express assembly: helmet/cors/json/cookies/requestId/limiters/morgan, mounts /api/v1
    ├── config/
    │   ├── env.js          # Zod-validated environment, fails fast on missing values
    │   └── index.js        # config object (http host, api path, cookie names)
    ├── core/
    │   └── ApiError.js     # Domain error + code map (moved from utils/)
    ├── db/
    │   └── prisma.js       # PrismaClient singleton
    ├── features/
    │   └── auth/           # Version-independent domain: the answer to v2 layering
    │       ├── auth.service.js  # register/login/refresh/logout/logoutAll/preferences
    │       ├── guards.js        # checkSession(token): verify + cache + tokenVersion re-check
    │       ├── sessionCache.js  # 60s in-memory session cache, invalidated on revoke
    │       ├── tokens.js        # JWT sign/verify/hash + refresh-cookie helpers
    │       └── index.js         # barrel for the feature's public surface
    ├── middlewares/        # Cross-cutting, app-level
    │   ├── requestId.js    # x-request-id per request (echoed in errors)
    │   ├── rateLimit.js    # createGlobalLimiter / createAuthLimiter / createRefreshLimiter -> 429 envelope
    │   ├── notFound.js     # 404 → ApiError
    │   ├── errorHandler.js # Every thrown value → { error } envelope
    │   └── validate.js     # Generic zod request-slice validator (hoisted from v1)
    ├── versions/
    │   └── v1/             # Transport only: routes, controllers, HTTP schemas
    │       ├── index.js    # Aggregates v1 routers
    │       ├── routes/     # health.routes.js, auth.routes.js (with limiters)
    │       ├── controllers/ # Thin: parse → call feature service → respond
    │       ├── middlewares/ # authenticate.js (thin adapter over features/auth/guards)
    │       └── schemas/    # auth.schema.js (zod request shapes)
    └── sockets/
        ├── index.js        # initSocket(server): Socket.IO + optional auth via features/auth/guards
        └── handlers/       # connection.js (rooms), ping.js (sample event)
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