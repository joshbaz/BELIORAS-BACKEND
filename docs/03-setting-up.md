# 03 — Setting Up

Every step below is already done in this repo; run them to recreate the
environment on a new machine.

## Prerequisites

- Node ≥ 22 (used for `node --watch`).
- Yarn classic (this repo is lockfile-compatible with yarn 1.x).
- Docker (for the local MongoDB), or a MongoDB instance reachable at
  `DATABASE_URL`.

## 1. Install dependencies

```sh
yarn
```

## 2. Environment

```sh
cp .env.example .env
```

Then fill `.env`. The secrets must be strong, e.g.:

```sh
openssl rand -base64 48
```

`PORT` defaults to **5002** — the client's Vite dev proxy forwards `/api` to
`localhost:5002` (`client/vite.config.js`). Change it only if you change the
proxy too.

## 3. Database (Docker)

MongoDB is **required to run as a single-node replica set** — Prisma issues
transactions even for a plain `create`, and the driver refuses non-replica
MongoDB.

```sh
docker compose up -d mongodb
```

First boot also needs one topology command (the data volume persists the
config afterwards):

```sh
docker exec belioras-mongodb mongosh --eval 'rs.initiate()'
sleep 6
# The default config advertises the container hostname, which the host cannot
# resolve — point the set at localhost so the driver can reach it:
docker exec belioras-mongodb mongosh --eval \
  'rs.reconfig({ _id: "rs0", version: 2, members: [{ _id: 0, host: "localhost:27017" }] }, { force: true })'
```

Verify: `docker exec belioras-mongodb mongosh --eval "rs.status().members[0].stateStr"` prints `PRIMARY`.

> If the container is ever recreated with this keep-alive volume, the set is
> still `rs0` with `localhost:27017` — no need to re-initiate.

## 4. Schema

```sh
yarn db:push      # prisma db push — Mongo has no migrations; this is the equivalent
yarn db:generate  # prisma generate (db push runs it already)
```

## 5. Run

```sh
yarn dev          # node --watch src/index.js
```

Healthy output:

```
MongoDB connected via mongodb://localhost:27017/belioras
Belioras API on http://0.0.0.0:5002/api/v1
Socket.IO attached
```

Smoke test:

```sh
curl http://localhost:5002/api/v1/health
# {"data":{"status":"ok","db":"connected",...}}
```

Open `yarn db:studio` to inspect collections.

## 6. Lint

```sh
yarn lint
```

## 7. Test

Requires the MongoDB from step 3 (tests write to the database named in
`DATABASE_URL`, using unique emails per run; they clean up after themselves).
The suite builds its app with rate limiting off so it can hammer the auth
endpoints, then exercises one limiter in isolation.

```sh
yarn test
```

## Debugging gotchas

| Symptom | Cause |
| --- | --- |
| `Prisma needs to perform transactions… replica set` | MongoDB not a replica set — see step 3. |
| `Server selection timeout … failed to lookup address` | Set advertises the container hostname — re-run the `reconfig` line. |
| `Unique constraint failed … refreshHash` | Stale install of the pre-fix schema where `refreshHash` was `@unique`; run `yarn db:push` and (if it persists) `db:studio` to clear duplicate `null` rows. |