# Belioras Server

Express + Socket.IO + Prisma (MongoDB) backend for the Belioras shop. Versioned
at `/api/v1`, speaking the exact contract the client already expects — see
[`docs/07-client-contract.md`](docs/07-client-contract.md).

## Quickstart

```sh
yarn                  # install
cp .env.example .env  # fill secrets (see below)
docker compose up -d mongodb
docker exec belioras-mongodb mongosh --eval 'rs.initiate()'
sleep 6
docker exec belioras-mongodb mongosh --eval \
  'rs.reconfig({ _id: "rs0", version: 2, members: [{ _id: 0, host: "localhost:27017" }] }, { force: true })'
yarn db:push          # prisma db push (Mongo has no migrations)
yarn seed:admin       # create/reset the first Administrator (see below)
yarn dev              # node --watch src/index.js  →  http://localhost:5002
```

MongoDB **must** run as a replica set (Prisma issues transactions even for
plain creates). First boot needs the `rs.initiate()`/`reconfig` lines above;
the data volume keeps the config afterwards. Full walkthrough with gotchas:
[`docs/03-setting-up.md`](docs/03-setting-up.md).

## The first Administrator

There is exactly one way to mint staff, and it works once: the admin boundary's
`register` refuses (`409`) as soon as any staff account exists, and the account
it creates is `super-admin`. For a fresh environment, either call

```sh
curl -X POST http://localhost:5002/api/v1/admin/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Belioras Administrator","email":"admin@belioras.com","password":"…at least 8 chars…"}'
```

or, repeatably, `yarn seed:admin` — it creates the account, or resets the
password and role of the one it created before, which is the way back in to a
locked-out admin. `SEED_ADMIN_PASSWORD` is required (the script is in a public
repository, so it has no default password of its own to publish); override
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_NAME` if you want something other than
`admin@belioras.com`. It refuses to touch any other staff account. Creating
*further* staff (`POST /admin/auth/staff`) is not implemented yet — see
[`docs/05-auth.md`](docs/05-auth.md).

## Scripts

| Command | What |
| --- | --- |
| `yarn dev` | Run with file watching (Node ≥ 22 `--watch`) |
| `yarn start` | Run without watching |
| `yarn db:push` | Sync the Prisma schema to MongoDB |
| `yarn db:generate` | Regenerate Prisma Client |
| `yarn db:studio` | Open Prisma Studio |
| `yarn seed:admin` | Create/reset the first Administrator |
| `yarn test` | `node --test` (needs a live Mongo replica set) |
| `yarn lint` | ESLint (flat config) |

## Stack

Express 5 · Socket.IO 4 · Prisma 6 (**stay on 6 — the `mongodb` provider was
removed in Prisma 7**) · jsonwebtoken · bcryptjs · zod 4 · cookie-parser ·
cors · helmet · morgan · ms. Reasons for each, and the version trap, in
[`docs/01-dependencies.md`](docs/01-dependencies.md).

## Layout at a glance

```
src/
├── index.js            # entry: db connect → app → sockets → listen
├── app.js              # express assembly, mounts /api/v1
├── config/             # zod-validated env + constants
├── db/prisma.js        # PrismaClient singleton
├── middlewares/        # requestId, notFound, errorHandler ({ error } envelope)
├── versions/v1/        # routes → controllers → schema-validated services
└── sockets/            # Socket.IO + optional JWT handshake auth
```

Documentation series: [`docs/`](docs/README.md) — conventions, dependencies,
structure, setup, HTTP API, auth, sockets, and the client contract.# BELIORAS-BACKEND
