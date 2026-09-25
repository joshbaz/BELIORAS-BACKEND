# 01 — Dependencies

## Runtime

| Package | Why |
| --- | --- |
| `express` ^5 | HTTP router. v5 auto-forwards async handler rejections to the error middleware — no manual try/catch wrapper. |
| `socket.io` ^4 | Real-time layer attached to the same HTTP server ([06](06-sockets.md)). |
| `@prisma/client` ^6 | Typed database client. **Pinned to v6 on purpose: the `mongodb` provider was dropped in Prisma 7.** |
| `jsonwebtoken` ^9 | HS256 access + refresh tokens ([05](05-auth.md)). |
| `bcryptjs` ^3 | Password hashing. Pure JS — no native binary, which keeps installs portable. |
| `zod` ^4 | Shared env validation and per-route request validation ([04](04-http-api.md)). |
| `dotenv` ^18 | Loads `.env` at the entry point before anything reads `process.env`. |
| `cookie-parser` ^1 | Reads the httpOnly refresh cookie per realm. |
| `cors` ^2 | Lets the client address the API cross-origin when it isn't proxied same-origin (production Netlify proxy, or `VITE_API_BASE_URL` set). |
| `helmet` ^8 | Security headers. |
| `morgan` ^1 | Dev request logging (skipped in production). |
| `ms` ^2 | Converts the `REFRESH_TOKEN_TTL` timespan string to a cookie `maxAge`. |
| `express-rate-limit` ^8 | IP rate limiting with a 429 that matches the error envelope ([04](04-http-api.md)). |

## Development

| Package | Why |
| --- | --- |
| `prisma` ^6 | CLI: `db push` (Mongo has no migrations), `studio`, `generate`. Matched to `@prisma/client` 6.x. |
| `eslint` + `@eslint/js` + `globals` | Flat-config linting per [00](00-code-conventions.md). |
| `supertest` ^7 | HTTP assertions on top of the built-in `node:test` runner (`test/`). |

## Explicitly not here

- **No ORM beyond Prisma**, no queue worker, no third-party test framework
  (`node:test` is built into Node ≥ 22), no build step — `node --watch` in dev,
  plain `node` in production.
- **No MongoDB driver configured by hand.** Prisma 6 connects with its own
  engine; adding `mongodb` directly would create a second client.
- That stays true until a step below (payments, email, object storage)
  genuinely requires a package. Add a dependency with a [01-dependencies]
  entry in the same change.