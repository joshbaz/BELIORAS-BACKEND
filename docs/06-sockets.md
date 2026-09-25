# 06 — Sockets

## Setup

Socket.IO attaches to the **same HTTP server** as Express
(`src/index.js` → `initSocket(server)`), so one port serves both.

- Engine transport deliberately restricted in tests to WebSocket; the client
  may use polling. CORS mirrors the HTTP `cors` origin with
  `credentials: true`.

## Auth middleware

The handshake may carry a Bearer access token:

```js
io(server, { auth: { token } })
```

- No token → the socket connects **anonymously** (storefront live data needs
  no sign-in).
- With a token → `checkSession` in `src/features/auth/guards.js` verifies and
  re-checks it against the user's stored `tokenVersion` — the **same guard the
  HTTP layer uses**, cache included ([05](05-auth.md)). Invalid →
  `connect_error` `"unauthorized"`.
- Success attaches `socket.user = { id, realm }`.

## Connection and rooms

On connect the server joins the socket to a room named after its audience:

| session | room |
| --- | --- |
| anonymous or customer | `public` |
| staff | `staff` |

and emits `connected` with `{ room, socketId }`.

## Events today

| Event | Direction | Payload |
| --- | --- | --- |
| `connected` | server → client | `{ room, socketId }` |
| `ping` | client → server | ack `{ pong: <ms timestamp> }` |

## What the rooms are for (intended)

The shipped server-core is the skeleton; these broadcasts will light up with
their modules:

- **Public room**: live stock ticks on a product page, "back on the shelf"
  after a refund, coupon redeemed.
- **Staff room**: new order bingo, `order-*` status changes, activity-log
  tail, "needs moderation" review counts.
- **User-scoped** (a socket joined to a private room keyed by user id — not
  implemented yet): live order status for a signed-in shopper and their
  notification toasts.

Broadcast helper: `getIo()` in `src/sockets/index.js` exports the server
instance for any service that must emit (e.g. `io.to("staff").emit(...)`).

## Adding an event

1. A handler file in `src/sockets/handlers/` registers its listeners on one
   socket (see `ping.js` for the pattern).
2. Wire it in `handlers/connection.js`.
3. Document the event in this file's table — the client will code against it.