/* Rate Limit Tests */

import "dotenv/config";
import assert from "node:assert/strict";
import express from "express";
import { describe, it } from "node:test";
import request from "supertest";
import { createAuthLimiter } from "../src/middlewares/rateLimit.js";
import { requestId } from "../src/middlewares/requestId.js";

/**
 * The credential limiter is two counters, and the reason for the second one is
 * that the first used to be communal. These cover the split, because "one
 * person's mistake locks out everyone behind the same IP" is the failure that
 * is easy to reintroduce and invisible until it is someone's afternoon.
 *
 * Each test builds its own app and passes `enabled: true`, since the limiters
 * are off outside production — otherwise nothing here would count.
 */

/** Mirrors the real app: JSON is parsed globally, before the route-level limiter. */
function appWith(limiter) {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(limiter);
  app.post("/login", (req, res) => res.json({ data: { ok: true } }));
  return app;
}

describe("rate limiting", () => {
  it("returns 429 with the error envelope after the limit", async () => {
    const app = appWith(createAuthLimiter({ enabled: true, limit: 3 }));

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post("/login").send({ email: "someone@example.com" });
      assert.equal(res.status, 200);
    }

    const blocked = await request(app).post("/login").send({ email: "someone@example.com" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "RATE_LIMITED");
    assert.ok(blocked.body.error.requestId);
  });

  it("counts a body with no email against the address, not against nobody", async () => {
    // A request that never parsed a body must still be limited, or a limiter
    // that buckets on a missing field is a limiter that can be walked around by
    // simply not sending the field.
    const app = appWith(createAuthLimiter({ enabled: true, limit: 2 }));

    for (let i = 0; i < 2; i++) {
      assert.equal((await request(app).post("/login")).status, 200);
    }
    assert.equal((await request(app).post("/login")).status, 429);
  });

  it("gives a colleague behind the same address their own bucket", async () => {
    // The bug this fixes: one address, one bucket. Here the limit is 2, so if
    // these shared a counter the second account would be locked out by the
    // first account's mistakes.
    const app = appWith(createAuthLimiter({ enabled: true, limit: 2 }));

    for (let i = 0; i < 2; i++) {
      const res = await request(app).post("/login").send({ email: "colleague@example.com" });
      assert.equal(res.status, 200, "the first account should be limited normally");
    }
    assert.equal((await request(app).post("/login").send({ email: "colleague@example.com" })).status, 429);

    const other = await request(app).post("/login").send({ email: "someone-else@example.com" });
    assert.equal(other.status, 200, "a different account from the same address must not be locked out");
  });

  it("treats the same address written differently as the same account", async () => {
    // Otherwise a lockout is trivially sidestepped by changing the capitalisation.
    const app = appWith(createAuthLimiter({ enabled: true, limit: 2 }));

    await request(app).post("/login").send({ email: "person@example.com" });
    await request(app).post("/login").send({ email: "  PERSON@example.com  " });
    const blocked = await request(app).post("/login").send({ email: "Person@Example.com" });

    assert.equal(blocked.status, 429, "case and padding must not mint a fresh bucket");
  });

  it("still bounds a spray across many accounts from one address", async () => {
    // The per-account buckets alone would not notice this: every attempt is a
    // new key. The address counter is what makes a sweep impractical.
    const app = appWith(createAuthLimiter({ enabled: true, limit: 50, ipLimit: 3 }));

    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await request(app).post("/login").send({ email: `target${i}@example.com` })).status);
    }

    assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
    assert.ok(statuses.slice(3).every((s) => s === 429), `spray should be cut off, got ${statuses.join(",")}`);
  });
});
